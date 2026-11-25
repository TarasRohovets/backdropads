using BackdropAds.Api.Data;
using BackdropAds.Api.Domain;
using BackdropAds.Api.Services.Providers;

namespace BackdropAds.Api.Services;

/// <summary>
/// Executes a flow in the background, step by step in edge order:
/// - Prompt step: edits its input image with the prompt (input = previous step's result when
///   "build on previous" is on, else the first image attachment), or generates from scratch.
///   The result feeds the next step.
/// - Output card: creates a real Generation (brief = the upstream prompts, reference = the
///   upstream result) so results land on the normal results page and can be saved to My Ads.
/// A run's estimated provider cost is quoted up front (see Plan) and corrected to what really ran.
/// </summary>
public class FlowRunner(
    IServiceScopeFactory scopes,
    ImageEditRouter editor,
    ProviderRouter providers,
    DocumentReader documentReader,
    IConfiguration configuration,
    ILogger<FlowRunner> logger)
{
    public sealed record RunPlan(List<string> Order, decimal EstimatedCostUsd, bool HasVideo, string? Error);

    /// <summary>Validate the flow and estimate its cost. Error is null when it can run.</summary>
    public static RunPlan Plan(Flow flow)
    {
        var outputs = flow.Nodes.Where(n => n.Type == "output").ToList();
        if (outputs.Count == 0)
            return new([], 0, false, "Add an output card so the flow knows what to make.");

        var emptySteps = flow.Nodes.Count(n => n.Type == "prompt" && string.IsNullOrWhiteSpace(n.Data.Prompt));
        if (emptySteps > 0)
            return new([], 0, false, emptySteps == 1 ? "One step has no prompt yet." : $"{emptySteps} steps have no prompt yet.");

        // An output card with its own prompt stands alone; one without needs a step to feed it.
        var orphanOutputs = outputs.Count(o => !flow.Edges.Any(e => e.Target == o.Id) && string.IsNullOrWhiteSpace(o.Data.Prompt));
        if (orphanOutputs > 0 && flow.Nodes.Any(n => n.Type == "prompt"))
            return new([], 0, false, "Connect every output card to a step.");

        var hasVideo = outputs.Any(o => o.Data.Mode == "video");

        // A card that targets a platform must ask for something that platform takes (a Reel is a video).
        foreach (var output in outputs)
            if (TryTarget(output.Data, out var p, out var pl)
                && !Taxonomy.TryValidate(p, pl, output.Data.Mode == "video" ? CreativeType.Video : CreativeType.Image, out _, out _))
                return new([], 0, false, $"\"{output.Data.Title}\" asks for {(output.Data.Mode == "video" ? "a video" : "an image")}, which {output.Data.Platform} {output.Data.Placement} doesn't take. Change the output type or the format.");

        var unknown = outputs.FirstOrDefault(o => OutputModel(o) is null);
        if (unknown is not null)
            return new([], 0, false, $"Unknown model '{unknown.Data.Model}' on an output card.");

        var cost = flow.Nodes.Sum(n => n.Type == "prompt" ? ModelCatalog.EditCostUsd : OutputCost(n));

        return new(TopologicalOrder(flow), cost, hasVideo, null);
    }

    /// <summary>The platform and format an output card targets ("instagram" + "reel"); false when it only sets a size.</summary>
    public static bool TryTarget(FlowStepData data, out Platform platform, out Placement placement)
    {
        platform = default;
        placement = default;
        if (string.IsNullOrWhiteSpace(data.Platform) || string.IsNullOrWhiteSpace(data.Placement)) return false;
        if (int.TryParse(data.Platform, out _) || int.TryParse(data.Placement, out _)) return false; // names only
        return Enum.TryParse(data.Platform, ignoreCase: true, out platform) && Enum.TryParse(data.Placement, ignoreCase: true, out placement);
    }

    private static AiModel? OutputModel(FlowNode node)
    {
        var kind = node.Data.Mode == "video" ? ModelKind.Video : ModelKind.Image;
        return string.IsNullOrWhiteSpace(node.Data.Model) ? ModelCatalog.Preferred(kind) : ModelCatalog.Find(kind, node.Data.Model);
    }

    /// <summary>Output cards cost the same as the equivalent generation.</summary>
    private static decimal OutputCost(FlowNode node)
    {
        var model = OutputModel(node) ?? ModelCatalog.Default(node.Data.Mode == "video" ? ModelKind.Video : ModelKind.Image);
        var isVideo = model.Kind == ModelKind.Video;
        var count = Math.Clamp(node.Data.Count ?? 1, 1, isVideo ? 2 : 6);
        return ModelCatalog.CostUsd(model, node.Data.Quality, isVideo ? ModelCatalog.Duration(model, node.Data.DurationSeconds) : 0, count);
    }

    /// <summary>Kahn's algorithm, left-to-right for ties; nodes in cycles go last so a run never hangs.</summary>
    public static List<string> TopologicalOrder(Flow flow)
    {
        var indegree = flow.Nodes.ToDictionary(n => n.Id, _ => 0);
        foreach (var e in flow.Edges) if (indegree.ContainsKey(e.Target)) indegree[e.Target]++;
        var queue = new List<string>(flow.Nodes.Where(n => indegree[n.Id] == 0).OrderBy(n => n.Position.X).Select(n => n.Id));
        var order = new List<string>();
        while (queue.Count > 0)
        {
            var id = queue[0];
            queue.RemoveAt(0);
            order.Add(id);
            foreach (var e in flow.Edges.Where(e => e.Source == id))
            {
                if (!indegree.ContainsKey(e.Target)) continue;
                if (--indegree[e.Target] == 0) queue.Add(e.Target);
            }
        }
        order.AddRange(flow.Nodes.Select(n => n.Id).Where(id => !order.Contains(id)));
        return order;
    }

    /// <summary>Background work runs after the request ends: each unit of work gets its own scope (DbContext) and saves.</summary>
    private T WithStore<T>(Func<AppStore, T> work)
    {
        using var scope = scopes.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<AppStore>();
        var result = work(store);
        store.Save();
        return result;
    }

    /// <summary>Write the run's progress onto the flow so GET /runs/{id} (any instance) sees it.</summary>
    private void PersistRun(FlowRun run)
    {
        try
        {
            WithStore(store =>
            {
                if (store.GetFlowById(run.FlowId) is { } flow) flow.LastRun = run;
                return 0;
            });
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Couldn't save progress of flow run {RunId}", run.Id);
        }
    }

    /// <summary>Kick off a run. Returns immediately; the run updates as it goes.</summary>
    public FlowRun Start(Flow flow, User user, RunPlan plan)
    {
        var run = new FlowRun
        {
            Id = Ids.New("run"),
            FlowId = flow.Id,
            WorkspaceId = flow.WorkspaceId,
            Status = "running",
            EstimatedCostUsd = plan.EstimatedCostUsd,
            StartedAt = DateTimeOffset.UtcNow,
            Steps = plan.Order.Select(id => new FlowRunStep { NodeId = id, Status = "queued" }).ToList(),
        };
        flow.LastRun = run;

        // Snapshot the graph so edits made while it runs don't change this run.
        var nodes = flow.Nodes.ToDictionary(n => n.Id);
        var edges = flow.Edges.ToList();
        _ = Task.Run(() => ExecuteAsync(flow.Name, user, run, nodes, edges));
        return run;
    }

    private bool MockPacing => configuration.GetValue("AI:UseMockData", true);

    private async Task ExecuteAsync(string flowName, User user, FlowRun run, Dictionary<string, FlowNode> nodes,
        List<FlowEdge> edges, Action? persist = null)
    {
        var save = persist ?? (() => PersistRun(run)); // a batch saves the run inside its own record instead
        var spent = 0m; // what really ran, at list prices
        try
        {
            foreach (var step in run.Steps)
            {
                if (!nodes.TryGetValue(step.NodeId, out var node)) { step.Status = "done"; continue; }
                step.Status = "running";
                save();

                if (node.Type == "prompt")
                {
                    if (MockPacing) await Task.Delay(900); // so the board visibly steps through in mock mode
                    spent += await RunPromptStepAsync(run, step, node, nodes, edges);
                }
                else
                {
                    spent += await RunOutputAsync(flowName, user, run, step, node, nodes, edges, save);
                }

                step.Status = "done";
            }

            run.Status = "completed";
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Flow run {RunId} failed", run.Id);
            var reason = ex is OutputFailedException failed ? failed.Message : null;
            var current = run.Steps.FirstOrDefault(s => s.Status == "running");
            if (current is not null) { current.Status = "failed"; current.Error = reason ?? "This step couldn't finish."; }
            run.Status = "failed";
            run.Error = reason ?? "The run stopped before finishing.";
        }
        finally
        {
            run.EstimatedCostUsd = spent;
            run.FinishedAt = DateTimeOffset.UtcNow;
            save();
        }
    }

    // ---- Several photos: the same flow, once per photo, one after another ------------------------------

    /// <summary>How many photos one batch may take.</summary>
    public const int MaxBatchInputs = 10;

    /// <summary>A batch that was interrupted (restart) stops blocking the flow after this long.</summary>
    public static readonly TimeSpan BatchStaleAfter = TimeSpan.FromHours(2);

    public static bool IsRunning(FlowBatch? batch) =>
        batch is { Status: "running" } && DateTimeOffset.UtcNow - batch.StartedAt < BatchStaleAfter;

    /// <summary>The first steps of a flow: prompt steps that don't build on another step. The input photo goes there.</summary>
    public static List<FlowNode> EntrySteps(Flow flow) =>
        [.. flow.Nodes.Where(n => n.Type == "prompt"
            && !flow.Edges.Any(e => e.Target == n.Id && flow.Nodes.Any(p => p.Id == e.Source && p.Type == "prompt")))];

    /// <summary>
    /// Kick off a batch. Returns immediately; photos are processed one at a time, so a batch of ten never asks the
    /// machine or the AI providers for ten things at once.
    /// </summary>
    public FlowBatch StartBatch(Flow flow, User user, RunPlan plan, List<string> inputUrls)
    {
        var batch = new FlowBatch
        {
            Id = Ids.New("batch"),
            FlowId = flow.Id,
            Status = "running",
            EstimatedCostUsd = plan.EstimatedCostUsd * inputUrls.Count,
            StartedAt = DateTimeOffset.UtcNow,
            Items = inputUrls.Select(url => new FlowBatchItem { InputUrl = url }).ToList(),
        };
        flow.LastBatch = batch;

        var entry = EntrySteps(flow).Select(n => n.Id).ToHashSet();
        var nodes = flow.Nodes.ToList();
        var edges = flow.Edges.ToList();
        var workspaceId = flow.WorkspaceId;
        _ = Task.Run(() => ExecuteBatchAsync(flow.Name, workspaceId, user, batch, nodes, entry, edges, plan));
        return batch;
    }

    private async Task ExecuteBatchAsync(string flowName, string workspaceId, User user, FlowBatch batch, List<FlowNode> nodes,
        HashSet<string> entrySteps, List<FlowEdge> edges, RunPlan plan)
    {
        try
        {
            foreach (var item in batch.Items)
            {
                item.Status = "running";
                item.Run = new FlowRun
                {
                    Id = Ids.New("run"),
                    FlowId = batch.FlowId,
                    WorkspaceId = workspaceId,
                    Status = "running",
                    EstimatedCostUsd = plan.EstimatedCostUsd,
                    StartedAt = DateTimeOffset.UtcNow,
                    Steps = plan.Order.Select(id => new FlowRunStep { NodeId = id, Status = "queued" }).ToList(),
                };
                // ExecuteAsync never throws: a failed photo is marked failed and the next one still runs.
                await ExecuteAsync(flowName, user, item.Run, WithInputPhoto(nodes, entrySteps, item.InputUrl), edges,
                    persist: () => PersistBatch(batch));
                item.Status = item.Run.Status == "completed" ? "done" : "failed";
                item.Error = item.Run.Error;
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Flow batch {BatchId} stopped early", batch.Id);
            foreach (var item in batch.Items.Where(i => i.Status is "queued" or "running")) { item.Status = "failed"; item.Error ??= "This photo wasn't processed."; }
        }
        finally
        {
            batch.Status = batch.Items.Any(i => i.Status == "done") ? "completed" : "failed";
            batch.EstimatedCostUsd = batch.Items.Sum(i => i.Run?.EstimatedCostUsd ?? 0m); // what really ran
            batch.FinishedAt = DateTimeOffset.UtcNow;
            PersistBatch(batch);
        }
    }

    /// <summary>The flow's steps with this photo as "image 1" of every first step (other attachments are kept).</summary>
    private static Dictionary<string, FlowNode> WithInputPhoto(List<FlowNode> nodes, HashSet<string> entrySteps, string photoUrl)
    {
        var result = new Dictionary<string, FlowNode>();
        foreach (var node in nodes)
        {
            if (!entrySteps.Contains(node.Id)) { result[node.Id] = node; continue; }
            var attachments = (node.Data.Attachments ?? []).ToList();
            var photo = new FlowAttachment { Id = Ids.New("att"), Name = "Input photo", Kind = "image", Url = photoUrl };
            var first = attachments.FindIndex(a => a.Kind == "image");
            if (first >= 0) attachments[first] = photo; else attachments.Insert(0, photo);
            result[node.Id] = new FlowNode
            {
                Id = node.Id,
                Type = node.Type,
                Position = node.Position,
                Data = new FlowStepData
                {
                    Kind = node.Data.Kind, Title = node.Data.Title, Prompt = node.Data.Prompt, Attachments = attachments,
                    UsePrevious = node.Data.UsePrevious, Mode = node.Data.Mode, Ratio = node.Data.Ratio, Count = node.Data.Count,
                    Quality = node.Data.Quality, BrandKitId = node.Data.BrandKitId, Model = node.Data.Model,
                    Platform = node.Data.Platform, Placement = node.Data.Placement,
                    DurationSeconds = node.Data.DurationSeconds,
                },
            };
        }
        return result;
    }

    private void PersistBatch(FlowBatch batch)
    {
        try
        {
            WithStore(store =>
            {
                if (store.GetFlowById(batch.FlowId) is { } flow && (flow.LastBatch is null || flow.LastBatch.Id == batch.Id)) flow.LastBatch = batch;
                return 0;
            });
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Couldn't save progress of flow batch {BatchId}", batch.Id);
        }
    }

    /// <summary>Upstream prompt step whose result this node builds on (the first done predecessor).</summary>
    private static FlowRunStep? PreviousResult(FlowRun run, FlowNode node, Dictionary<string, FlowNode> nodes, List<FlowEdge> edges) =>
        edges.Where(e => e.Target == node.Id)
            .Select(e => run.Steps.FirstOrDefault(s => s.NodeId == e.Source && s.Status == "done"))
            .FirstOrDefault(s => s is not null && nodes.TryGetValue(s.NodeId, out var n) && n.Type == "prompt");

    /// <summary>Runs one prompt step and returns its estimated provider cost.</summary>
    private async Task<decimal> RunPromptStepAsync(FlowRun run, FlowRunStep step, FlowNode node, Dictionary<string, FlowNode> nodes, List<FlowEdge> edges)
    {
        var prompt = node.Data.Prompt!.Trim();
        // PDFs / text attached to this step: the LLM reads them; its notes extend the step's prompt.
        var documents = DocumentUrls(node);
        if (documents.Count > 0 && await documentReader.DigestAsync(documents, prompt) is { Length: > 0 } notes)
            prompt += $"\n\nFrom the attached documents:\n{notes}";
        var previous = node.Data.UsePrevious != false ? PreviousResult(run, node, nodes, edges) : null;
        var attachedImages = (node.Data.Attachments ?? []).Where(a => a.Kind == "image" && !string.IsNullOrWhiteSpace(a.Url)).Select(a => a.Url!).ToList();
        var attachedImage = attachedImages.FirstOrDefault();
        var fallbackSeed = $"flow-{run.Id}-{node.Id}";

        GeneratedMedia media;
        if (previous is not null || attachedImage is not null)
        {
            // Edit the input: the previous step's result, else the attached reference image.
            // The previous result (or first attachment) is image 1; every attached image follows.
            media = await editor.EditAsync(new EditSpec(
                previous?.MediaUrl ?? attachedImage,
                previous?.ResultSeed ?? fallbackSeed,
                prompt,
                "1:1",
                ExtraImageUrls: previous is not null ? attachedImages : attachedImages.Skip(1).ToList()));
        }
        else
        {
            // First step with nothing to edit — generate from the prompt.
            var generation = new Generation
            {
                Id = run.Id,
                Platform = Platform.Facebook,
                Placement = Placement.Feed,
                CreativeType = CreativeType.Image,
                AspectRatio = "1:1",
                Brief = new Brief { ProductName = TextLimits.Cut(node.Data.Title, TextLimits.Name) ?? "", ProductDescription = TextLimits.Cut(prompt, TextLimits.Prompt), KeyBenefit = TextLimits.Cut(prompt, 400) ?? "" },
            };
            media = await providers.GenerateAsync(generation, new Concept { Hook = node.Data.Title, AspectRatio = "1:1" });
        }

        if (media.IsFallback)
            throw new InvalidOperationException("No image model could run this step.");

        step.Model = media.Model;
        step.MediaUrl = media.Url;
        step.ResultSeed = media.ImageSeed ?? fallbackSeed;
        return media.Provider == "mock" ? 0m : ModelCatalog.EditCostUsd;
    }

    private static List<string> DocumentUrls(FlowNode node) =>
        [.. (node.Data.Attachments ?? []).Where(a => a.Kind is "pdf" or "text" && !string.IsNullOrWhiteSpace(a.Url)).Select(a => a.Url!)];

    private static readonly Dictionary<string, (Platform Platform, Placement Placement)> ImageTargets = new()
    {
        ["1:1"] = (Platform.Facebook, Placement.Feed),
        ["4:5"] = (Platform.Instagram, Placement.Feed),
        ["9:16"] = (Platform.Instagram, Placement.Story),
        ["2:3"] = (Platform.Pinterest, Placement.Pin),
    };

    private static readonly Dictionary<string, (Platform Platform, Placement Placement)> VideoTargets = new()
    {
        ["9:16"] = (Platform.Tiktok, Placement.Video),
        ["1:1"] = (Platform.Facebook, Placement.Feed),
        ["16:9"] = (Platform.Youtube, Placement.Video),
    };

    /// <summary>Create a real Generation for the output card and wait for it. Returns its estimated cost.</summary>
    private async Task<decimal> RunOutputAsync(string flowName, User user, FlowRun run, FlowRunStep step, FlowNode node,
        Dictionary<string, FlowNode> nodes, List<FlowEdge> edges, Action save)
    {
        var isVideo = node.Data.Mode == "video";
        var count = Math.Clamp(node.Data.Count ?? 1, 1, isVideo ? 2 : 6);
        var targets = isVideo ? VideoTargets : ImageTargets;
        var (platform, placement) = targets.TryGetValue(node.Data.Ratio ?? "", out var t) ? t : targets.First().Value;
        // The card names where the ad will run: that decides the format and the size.
        if (TryTarget(node.Data, out var targetPlatform, out var targetPlacement)) (platform, placement) = (targetPlatform, targetPlacement);
        var creativeType = isVideo ? CreativeType.Video : CreativeType.Image;
        if (!Taxonomy.TryValidate(platform, placement, creativeType, out var aspectRatio, out var error))
            throw new InvalidOperationException(error);

        // Everything upstream, in run order, becomes the brief.
        var ancestors = Ancestors(node.Id, edges);
        var upstreamPrompts = run.Steps
            .Where(s => ancestors.Contains(s.NodeId) && nodes.TryGetValue(s.NodeId, out var n) && n.Type == "prompt")
            .Select(s => nodes[s.NodeId].Data.Prompt!.Trim())
            .ToList();
        var previous = PreviousResult(run, node, nodes, edges);
        // Nothing connected: the card's own prompt (and product photo) make the ad, in one generation.
        var ownPrompt = upstreamPrompts.Count == 0 && !string.IsNullOrWhiteSpace(node.Data.Prompt) ? node.Data.Prompt.Trim() : null;
        var ownPhoto = previous is null
            ? (node.Data.Attachments ?? []).Where(a => a.Kind == "image" && !string.IsNullOrWhiteSpace(a.Url)).Select(a => a.Url).FirstOrDefault()
            : null;
        if (ownPrompt is not null) upstreamPrompts.Add(ownPrompt);
        var upstreamDocuments = run.Steps
            .Where(s => ancestors.Contains(s.NodeId) && nodes.TryGetValue(s.NodeId, out var n) && n.Type == "prompt")
            .SelectMany(s => DocumentUrls(nodes[s.NodeId]))
            .Distinct().Take(DocumentReader.MaxDocuments).ToList();

        BrandKit? brand = null;
        if (!string.Equals(node.Data.BrandKitId, "none", StringComparison.OrdinalIgnoreCase))
            brand = WithStore(store => store.FindBrandKit(run.WorkspaceId, string.IsNullOrWhiteSpace(node.Data.BrandKitId) ? "primary" : node.Data.BrandKitId!));

        var lastPrompt = upstreamPrompts.LastOrDefault() ?? node.Data.Title;
        var model = OutputModel(node) ?? ModelCatalog.Default(isVideo ? ModelKind.Video : ModelKind.Image);
        var cost = OutputCost(node);
        var generation = WithStore(store => store.AddGeneration(new Generation
        {
            Id = Ids.New("gen"),
            UserId = user.Id,
            WorkspaceId = run.WorkspaceId,
            Platform = platform,
            Placement = placement,
            CreativeType = creativeType,
            AspectRatio = aspectRatio,
            Brief = new Brief
            {
                ProductName = string.IsNullOrWhiteSpace(flowName) ? node.Data.Title : flowName,
                ProductDescription = ownPrompt ?? string.Join("\n\n", upstreamPrompts.Select((p, i) => $"Step {i + 1}: {p}")),
                TargetAudience = "General consumers",
                TargetMarket = "United States",
                Language = "English (US)",
                Tone = string.IsNullOrWhiteSpace(brand?.Tone) ? "Bold & punchy" : brand!.Tone,
                KeyBenefit = lastPrompt.Split('.', '!', '\n')[0].Trim(),
                CallToAction = string.IsNullOrWhiteSpace(brand?.DefaultCta) ? "Shop now" : brand!.DefaultCta,
                ReferenceCreativeUrl = previous?.MediaUrl ?? ownPhoto,
                DocumentUrls = upstreamDocuments,
            },
            ConceptCount = count,
            Quality = ModelCatalog.IsHigh(node.Data.Quality) ? "high" : "standard",
            Model = model.Id,
            DurationSeconds = isVideo ? ModelCatalog.Duration(model, node.Data.DurationSeconds) : null,
            EstimatedCostUsd = cost,
            Brand = brand,
            // Keep the output visually tied to the chain in mock mode.
            ProductImageSeed = previous?.ResultSeed,
            Status = GenerationStatus.Processing,
            CreatedAt = DateTimeOffset.UtcNow,
            Concepts = [],
        }));
        step.GenerationId = generation.Id;
        save();

        // Generations complete on read; poll until done (real providers can take a while).
        var deadline = DateTimeOffset.UtcNow + TimeSpan.FromMinutes(isVideo ? 10 : 3);
        Generation? done = null;
        while (DateTimeOffset.UtcNow < deadline)
        {
            done = WithStore(store => store.GetGeneration(generation.Id, run.WorkspaceId));
            if (done?.Status == GenerationStatus.Completed) break;
            if (done?.Status == GenerationStatus.Failed)
                throw new OutputFailedException(done.Error ?? "The output couldn't be generated.");
            await Task.Delay(1000);
        }
        if (done?.Status != GenerationStatus.Completed)
            throw new TimeoutException("Output generation did not complete in time.");

        step.Model = done.Concepts.FirstOrDefault()?.Model;
        step.ResultSeeds = [.. done.Concepts.Select(c => c.ImageSeed)];
        step.ResultUrls = [.. done.Concepts.Select(c => c.MediaUrl)];

        return done.EstimatedCostUsd; // corrected by the generation to what really ran
    }

    private static HashSet<string> Ancestors(string nodeId, List<FlowEdge> edges)
    {
        var seen = new HashSet<string>();
        var stack = new Stack<string>([nodeId]);
        while (stack.Count > 0)
        {
            var id = stack.Pop();
            foreach (var e in edges.Where(e => e.Target == id))
                if (seen.Add(e.Source)) stack.Push(e.Source);
        }
        return seen;
    }
}

/// <summary>An output card's generation failed; the message says why (shown on the board).</summary>
public sealed class OutputFailedException(string message) : Exception(message);
