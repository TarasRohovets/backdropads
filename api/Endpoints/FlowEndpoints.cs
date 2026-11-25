using BackdropAds.Api.Data;
using BackdropAds.Api.Domain;
using BackdropAds.Api.Services;

namespace BackdropAds.Api.Endpoints;

public static class FlowEndpoints
{
    private const int MaxNodes = 40;

    public static IEndpointRouteBuilder MapFlowEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/flows").WithTags("Flows");

        // The list leaves out each flow's chat and versions (the board loads them with the flow).
        group.MapGet("/", (AppStore store, IUserContext user) =>
            Results.Ok(store.ListFlows(user.WorkspaceId).Select(f => new { f.Id, f.Name, f.Nodes, f.Edges, f.CreatedAt, f.UpdatedAt, f.LastRun, f.LastBatch })));

        group.MapGet("/{id}", (string id, AppStore store, IUserContext user) =>
            store.GetFlow(id, user.WorkspaceId) is { } flow ? Results.Ok(flow) : Results.NotFound(new { error = $"Flow '{id}' not found." }));

        // Starter flows a new flow can begin from.
        group.MapGet("/templates", () => Results.Ok(FlowTemplates.All.Select(t => new
        {
            t.Id,
            t.Name,
            t.Description,
            t.Mode,
            t.Ratio,
            steps = t.Steps.Select(s => s.Title),
        })));

        // Import a flow file made by "Export". Everything is re-checked and gets fresh ids; photos never travel.
        group.MapPost("/import", (ImportFlowRequest request, AppStore store, IUserContext user) =>
        {
            var (imported, error) = FlowFiles.Read(request.Format, request.Name, request.Nodes, request.Edges);
            if (imported is null) return Results.BadRequest(new { error });

            var now = DateTimeOffset.UtcNow;
            var flow = store.AddFlow(new Flow
            {
                Id = Ids.New("flow"),
                UserId = user.UserId,
                WorkspaceId = user.WorkspaceId,
                Name = imported.Name,
                Nodes = imported.Nodes,
                Edges = imported.Edges,
                CreatedAt = now,
                UpdatedAt = now,
            });
            return Results.Created($"/api/flows/{flow.Id}", flow);
        });

        // "Create with AI": one message → a flow with one output card per image (or video), each with its own prompt.
        // Uses Claude with your Anthropic key (like Improve with AI); nothing is generated until the flow is run.
        group.MapPost("/compose", async (ComposeFlowRequest request, AppStore store, IUserContext userContext,
            AiTextGate gate, FlowComposer composer, MediaStore media, ClaudeText claude, CancellationToken ct) =>
        {
            var message = request.Message?.Trim() ?? "";
            if (message.Length < 5) return Results.BadRequest(new { error = "Tell us what you'd like to make — a sentence is enough." });
            if (message.Length > TextLimits.Idea) return Results.BadRequest(new { error = $"Keep it under {TextLimits.Idea:N0} characters." });
            var photos = (request.PhotoUrls ?? []).Prepend(request.PhotoUrl)
                .Where(u => !string.IsNullOrWhiteSpace(u)).Select(u => u!.Trim()).Distinct().ToList();
            if (photos.Count > FlowComposer.MaxImages) return Results.BadRequest(new { error = $"Pick up to {FlowComposer.MaxImages} photos." });
            if (photos.Any(u => !media.IsOwn(u))) return Results.BadRequest(new { error = "Pick photos from your upload library." });

            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();
            var (ticket, refusal) = await gate.OpenAsync(user, request.TextModel);
            if (refusal is not null) return refusal;

            ComposedFlow plan;
            try
            {
                var brand = store.FindBrandKit(userContext.WorkspaceId, "primary")?.BrandName;
                // Claude looks at the photos it writes edits for (only image types it reads, and not huge files).
                var seen = new List<(byte[] Bytes, string MimeType)>();
                if (claude.Live)
                    foreach (var url in photos)
                        if (await media.TryReadOwnAsync(url, ct) is { } file && file.Bytes.Length <= 3_500_000
                            && file.MimeType is "image/jpeg" or "image/png" or "image/webp" or "image/gif")
                            seen.Add(file);
                if (seen.Count != photos.Count) seen.Clear(); // numbering must match: all or none
                plan = await composer.ComposeAsync(message, photos.Count, seen, brand, ticket!.Model.Id, ct);
            }
            catch (OperationCanceledException)
            {
                await gate.CancelAsync(ticket!);
                throw;
            }
            var (used, limit) = await gate.CloseAsync(ticket, plan.ByAi, plan.Model, plan.CostUsd);

            var made = CardsFlow(user.Id, userContext.WorkspaceId, plan.Name, plan.Mode, plan.Ratio,
                plan.Items.Select(i => (i.Title, i.Prompt, (string?)null, i.Photo is { } p && photos.Count > 0 ? photos[Math.Clamp(p, 1, photos.Count) - 1] : null)));
            var noun = plan.Mode == "video" ? (plan.Items.Count == 1 ? "video" : "videos") : plan.Items.Count == 1 ? "image" : "images";
            StartHistory(made, message, $"Planned {plan.Items.Count} {noun}: {string.Join(", ", plan.Items.Select(i => i.Title))}.", message);
            var flow = store.AddFlow(made);
            var price = FlowRunner.Plan(flow);
            return Results.Created($"/api/flows/{flow.Id}", new
            {
                flow,
                cost = price.EstimatedCostUsd,
                // Why it can't run as is (video on the free plan, for example); null when it can.
                runError = price.Error,
                byAi = plan.ByAi,
                model = plan.ByAi && plan.Model is not null ? AiPlans.NameOf(plan.Model) : null,
                used,
                limit,
            });
        });

        // Saved prompts → a flow: a prompt group (or picked prompts) becomes one output card per prompt, ready to run.
        // No AI writing here; nothing is generated until the flow is run.
        group.MapPost("/from-prompts", (FlowFromPromptsRequest request, AppStore store, IUserContext userContext, MediaStore media) =>
        {
            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();
            var photo = string.IsNullOrWhiteSpace(request.PhotoUrl) ? null : request.PhotoUrl.Trim();
            if (photo is not null && !media.IsOwn(photo)) return Results.BadRequest(new { error = "Pick a photo from your upload library." });

            PromptGroup? promptGroup = null;
            List<SavedPrompt> prompts;
            if (!string.IsNullOrWhiteSpace(request.GroupId))
            {
                promptGroup = store.GetPromptGroup(request.GroupId, userContext.WorkspaceId);
                if (promptGroup is null) return Results.NotFound(new { error = "That prompt group doesn't exist any more." });
                prompts = store.ListGroupPrompts(promptGroup.Id, userContext.WorkspaceId);
            }
            else
            {
                var ids = (request.PromptIds ?? []).Distinct().ToList();
                var all = store.ListPrompts(userContext.WorkspaceId).ToDictionary(p => p.Id);
                prompts = [.. ids.Where(all.ContainsKey).Select(id => all[id])];
            }
            if (prompts.Count == 0) return Results.BadRequest(new { error = "Pick at least one prompt." });
            if (prompts.Count > FlowComposer.MaxImages)
                return Results.BadRequest(new { error = $"Send up to {FlowComposer.MaxImages} prompts at a time." });

            var mode = promptGroup?.Kind ?? (prompts.All(p => p.Kind == "video") ? "video" : "image");
            var ratio = promptGroup?.Ratio ?? (mode == "video" ? "9:16" : "4:5");
            var made = CardsFlow(user.Id, userContext.WorkspaceId, promptGroup?.Name ?? prompts[0].Title, mode, ratio,
                prompts.Select(p => (p.Title, p.Text, p.TargetModel, photo)));
            var source = promptGroup is not null ? $"the prompt set “{promptGroup.Name}”" : prompts.Count == 1 ? "a saved prompt" : "saved prompts";
            StartHistory(made, promptGroup?.Message, $"Made from {source}: one card per prompt.", promptGroup?.Message ?? $"From {source}");
            var flow = store.AddFlow(made);
            foreach (var p in prompts) store.MarkPromptUsed(p.Id, userContext.WorkspaceId);
            var price = FlowRunner.Plan(flow);
            return Results.Created($"/api/flows/{flow.Id}", new { flow, cost = price.EstimatedCostUsd, runError = price.Error, byAi = false, model = (string?)null });
        });

        // The chat inside a flow: "now add x, y, z to the images" → AI edits the cards in the context of this flow.
        // Every change is a new version (v1 = how it started); the chat and versions are saved on the flow.
        group.MapPost("/{id}/chat", async (string id, FlowChatRequest request, AppStore store, IUserContext userContext,
            AiTextGate gate, FlowEditor editor, CancellationToken ct) =>
        {
            var message = request.Message?.Trim() ?? "";
            if (message.Length < 2) return Results.BadRequest(new { error = "Say what to change." });
            if (message.Length > TextLimits.Idea) return Results.BadRequest(new { error = $"Keep it under {TextLimits.Idea:N0} characters." });
            var flow = store.GetFlow(id, userContext.WorkspaceId);
            if (flow is null) return Results.NotFound(new { error = $"Flow '{id}' not found." });
            if (flow.LastRun?.Status == "running" || FlowRunner.IsRunning(flow.LastBatch))
                return Results.Conflict(new { error = "Wait for the run to finish, then change the flow." });
            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();

            var (ticket, refusal) = await gate.OpenAsync(user, request.TextModel);
            if (refusal is not null) return refusal;
            FlowEdit edit;
            try
            {
                // The history starts with how the flow is now; hand edits since the last version are kept as their own.
                if (flow.Versions.Count == 0) Snapshot(flow, "How it started");
                else if (Shape(flow.Nodes, flow.Edges) != Shape(flow.Versions[^1].Nodes, flow.Versions[^1].Edges)) Snapshot(flow, "Your edits");
                edit = await editor.EditAsync(flow, message, ticket!.Model.Id, ct);
            }
            catch (OperationCanceledException)
            {
                await gate.CancelAsync(ticket!);
                throw;
            }
            var (used, limit) = await gate.CloseAsync(ticket, edit.ByAi, edit.Model, edit.CostUsd);

            Say(flow, "user", message);
            var changed = Apply(flow, edit);
            var version = changed ? Snapshot(flow, message) : null;
            Say(flow, "assistant", changed ? edit.Reply : edit.Cards.Count == 0 ? edit.Reply : $"{edit.Reply} (Nothing needed changing.)", version?.Version);
            flow.UpdatedAt = DateTimeOffset.UtcNow;

            var price = FlowRunner.Plan(flow);
            return Results.Ok(new
            {
                flow,
                reply = edit.Reply,
                changed,
                version = version?.Version,
                cost = price.EstimatedCostUsd,
                byAi = edit.ByAi,
                model = edit.ByAi && edit.Model is not null ? AiPlans.NameOf(edit.Model) : null,
                used,
                limit,
            });
        });

        // Go back to any version: the cards become that version again (saved as a new version, so nothing is lost).
        group.MapPost("/{id}/versions/{version:int}/restore", (string id, int version, AppStore store, IUserContext userContext) =>
        {
            var flow = store.GetFlow(id, userContext.WorkspaceId);
            if (flow is null) return Results.NotFound(new { error = $"Flow '{id}' not found." });
            if (flow.LastRun?.Status == "running" || FlowRunner.IsRunning(flow.LastBatch))
                return Results.Conflict(new { error = "Wait for the run to finish." });
            var target = flow.Versions.FirstOrDefault(v => v.Version == version);
            if (target is null) return Results.NotFound(new { error = $"Version {version} not found." });
            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();

            if (Shape(flow.Nodes, flow.Edges) != Shape(flow.Versions[^1].Nodes, flow.Versions[^1].Edges)) Snapshot(flow, "Your edits");
            flow.Nodes = Clone(target.Nodes);
            flow.Edges = Clone(target.Edges);
            var restored = Snapshot(flow, $"Restored v{version}");
            Say(flow, "assistant", $"Back to v{version}.", restored.Version);
            flow.UpdatedAt = DateTimeOffset.UtcNow;
            return Results.Ok(new { flow, cost = FlowRunner.Plan(flow).EstimatedCostUsd });
        });

        // New flows start blank (one prompt step connected to one output card) or from a starter flow.
        group.MapPost("/", (CreateFlowRequest request, AppStore store, IUserContext user) =>
        {
            var template = FlowTemplates.Blank;
            if (!string.IsNullOrWhiteSpace(request.TemplateId))
            {
                if (FlowTemplates.Find(request.TemplateId) is not { } found)
                    return Results.BadRequest(new { error = $"Unknown starter flow '{request.TemplateId}'." });
                template = found;
            }

            var now = DateTimeOffset.UtcNow;
            var (nodes, edges) = FlowTemplates.Build(template);
            var flow = store.AddFlow(new Flow
            {
                Id = Ids.New("flow"),
                UserId = user.UserId,
                WorkspaceId = user.WorkspaceId,
                Name = !string.IsNullOrWhiteSpace(request.Name) ? request.Name.Trim() : template == FlowTemplates.Blank ? "Untitled flow" : template.Name,
                Nodes = nodes,
                Edges = edges,
                CreatedAt = now,
                UpdatedAt = now,
            });
            return Results.Created($"/api/flows/{flow.Id}", flow);
        });

        // Autosave from the board: name, cards and arrows.
        group.MapPut("/{id}", (string id, UpdateFlowRequest request, AppStore store, IUserContext user) =>
        {
            var flow = store.GetFlow(id, user.WorkspaceId);
            if (flow is null) return Results.NotFound(new { error = $"Flow '{id}' not found." });

            if (request.Nodes is { Count: > MaxNodes })
                return Results.BadRequest(new { error = $"A flow can have up to {MaxNodes} cards." });

            if (!string.IsNullOrWhiteSpace(request.Name)) flow.Name = request.Name.Trim();
            if (request.Nodes is not null)
            {
                foreach (var n in request.Nodes)
                {
                    if (n.Type is not ("prompt" or "output"))
                        return Results.BadRequest(new { error = $"Unknown card type '{n.Type}'." });
                    n.Data.Kind = n.Type;
                }
                flow.Nodes = request.Nodes;
            }
            if (request.Edges is not null)
            {
                var ids = flow.Nodes.Select(n => n.Id).ToHashSet();
                var outputs = flow.Nodes.Where(n => n.Type == "output").Select(n => n.Id).ToHashSet();
                // Keep only arrows between existing cards; outputs are the end of the line.
                flow.Edges = request.Edges
                    .Where(e => ids.Contains(e.Source) && ids.Contains(e.Target) && e.Source != e.Target && !outputs.Contains(e.Source))
                    .GroupBy(e => (e.Source, e.Target)).Select(g => g.First())
                    .ToList();
            }
            flow.UpdatedAt = DateTimeOffset.UtcNow;
            return Results.Ok(flow);
        });

        // Copy: same cards and arrows under new ids, no results.
        group.MapPost("/{id}/duplicate", (string id, AppStore store, IUserContext user) =>
        {
            var source = store.GetFlow(id, user.WorkspaceId);
            if (source is null) return Results.NotFound(new { error = $"Flow '{id}' not found." });

            var idMap = source.Nodes.ToDictionary(n => n.Id, n => Ids.New(n.Type == "output" ? "out" : "step"));
            var now = DateTimeOffset.UtcNow;
            var copy = store.AddFlow(new Flow
            {
                Id = Ids.New("flow"),
                UserId = user.UserId,
                WorkspaceId = user.WorkspaceId,
                Name = $"{source.Name} (copy)",
                Nodes = source.Nodes.Select(n => new FlowNode
                {
                    Id = idMap[n.Id],
                    Type = n.Type,
                    Position = new FlowPosition { X = n.Position.X, Y = n.Position.Y },
                    Data = new FlowStepData
                    {
                        Kind = n.Data.Kind,
                        Title = n.Data.Title,
                        Prompt = n.Data.Prompt,
                        Attachments = n.Data.Attachments?.Select(a => new FlowAttachment { Id = Ids.New("att"), Name = a.Name, Kind = a.Kind, Size = a.Size, Url = a.Url }).ToList(),
                        UsePrevious = n.Data.UsePrevious,
                        Mode = n.Data.Mode,
                        Ratio = n.Data.Ratio,
                        Platform = n.Data.Platform,
                        Placement = n.Data.Placement,
                        Count = n.Data.Count,
                        Quality = n.Data.Quality,
                        BrandKitId = n.Data.BrandKitId,
                        Model = n.Data.Model,
                        DurationSeconds = n.Data.DurationSeconds,
                    },
                }).ToList(),
                Edges = source.Edges
                    .Where(e => idMap.ContainsKey(e.Source) && idMap.ContainsKey(e.Target))
                    .Select(e => new FlowEdge { Id = Ids.New("e"), Source = idMap[e.Source], Target = idMap[e.Target] })
                    .ToList(),
                CreatedAt = now,
                UpdatedAt = now,
            });
            return Results.Created($"/api/flows/{copy.Id}", copy);
        });

        group.MapDelete("/{id}", (string id, AppStore store, IUserContext user) =>
        {
            var flow = store.GetFlow(id, user.WorkspaceId);
            if (flow?.LastRun?.Status == "running")
                return Results.Conflict(new { error = "This flow is running — wait for it to finish." });
            return store.RemoveFlow(id, user.WorkspaceId) ? Results.NoContent() : Results.NotFound(new { error = $"Flow '{id}' not found." });
        });

        // Run: validate → one run at a time → rate limit → execute in background.
        group.MapPost("/{id}/run", (string id, HttpContext http, AppStore store, IUserContext userContext,
            RateLimitService limits, FlowRunner runner) =>
        {
            var flow = store.GetFlow(id, userContext.WorkspaceId);
            if (flow is null) return Results.NotFound(new { error = $"Flow '{id}' not found." });
            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();

            if (flow.LastRun?.Status == "running" || FlowRunner.IsRunning(flow.LastBatch))
                return Results.Conflict(new { error = "This flow is already running." });

            var plan = FlowRunner.Plan(flow);
            if (plan.Error is not null) return Results.BadRequest(new { error = plan.Error });

            if (!limits.TryAcquireImage(user.Id, out var retryAfter) || (plan.HasVideo && !limits.TryAcquireVideo(user.Id, out retryAfter)))
                return Guards.TooManyRequests(http, "You've hit the generation rate limit. Take a breather.", retryAfter);

            var run = runner.Start(flow, user, plan);
            return Results.Accepted($"/api/flows/{flow.Id}/runs/{run.Id}", run);
        });

        // Run on several photos: the same flow once per photo, queued one after another (max 10).
        group.MapPost("/{id}/run-batch", (string id, RunFlowBatchRequest request, HttpContext http, AppStore store,
            IUserContext userContext, RateLimitService limits, MediaStore media, FlowRunner runner) =>
        {
            var flow = store.GetFlow(id, userContext.WorkspaceId);
            if (flow is null) return Results.NotFound(new { error = $"Flow '{id}' not found." });
            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();

            var inputs = (request.InputUrls ?? []).Where(u => !string.IsNullOrWhiteSpace(u)).Select(u => u.Trim()).Distinct().ToList();
            if (inputs.Count == 0) return Results.BadRequest(new { error = "Pick at least one photo." });
            if (inputs.Count > FlowRunner.MaxBatchInputs)
                return Results.BadRequest(new { error = $"Pick up to {FlowRunner.MaxBatchInputs} photos at a time." });
            if (inputs.Any(u => !media.IsOwn(u)))
                return Results.BadRequest(new { error = "Pick photos from your upload library." });

            if (flow.LastRun?.Status == "running" || FlowRunner.IsRunning(flow.LastBatch))
                return Results.Conflict(new { error = "This flow is already running." });

            var plan = FlowRunner.Plan(flow);
            if (plan.Error is not null) return Results.BadRequest(new { error = plan.Error });
            if (FlowRunner.EntrySteps(flow).Count == 0)
                return Results.BadRequest(new { error = "Add a step first: each photo goes into the flow's first step." });

            if (!limits.TryAcquireImage(user.Id, out var retryAfter) || (plan.HasVideo && !limits.TryAcquireVideo(user.Id, out retryAfter)))
                return Guards.TooManyRequests(http, "You've hit the generation rate limit. Take a breather.", retryAfter);

            var batch = runner.StartBatch(flow, user, plan, inputs);
            return Results.Accepted($"/api/flows/{flow.Id}/batch", batch);
        });

        // Poll the batch (progress per photo).
        group.MapGet("/{id}/batch", (string id, AppStore store, IUserContext user) =>
        {
            var flow = store.GetFlow(id, user.WorkspaceId);
            if (flow is null) return Results.NotFound(new { error = $"Flow '{id}' not found." });
            return flow.LastBatch is null ? Results.NoContent() : Results.Ok(flow.LastBatch);
        });

        // Poll a run (the board polls this while it animates).
        group.MapGet("/{id}/runs/{runId}", (string id, string runId, AppStore store, IUserContext user) =>
        {
            var flow = store.GetFlow(id, user.WorkspaceId);
            return flow?.LastRun?.Id == runId
                ? Results.Ok(flow.LastRun)
                : Results.NotFound(new { error = "Run not found." });
        });

        return app;
    }

    // ---- versions & the flow chat ---------------------------------------------------------

    private const int MaxVersions = 30;
    private const int MaxChatTurns = 100;

    private static T Clone<T>(T value) => System.Text.Json.JsonSerializer.Deserialize<T>(System.Text.Json.JsonSerializer.Serialize(value))!;

    /// <summary>What a version is about: the cards' words and settings (not where they sit on the board).</summary>
    private static string Shape(IEnumerable<FlowNode> nodes, IEnumerable<FlowEdge> edges) =>
        System.Text.Json.JsonSerializer.Serialize(new
        {
            n = nodes.Select(n => new { n.Id, n.Type, n.Data.Title, n.Data.Prompt, n.Data.Mode, n.Data.Ratio, n.Data.Count, n.Data.Model, n.Data.Quality }),
            e = edges.Select(e => $"{e.Source}>{e.Target}").OrderBy(x => x),
        });

    /// <summary>Saves the cards as they are now as the next version (v1 stays; the oldest others go past the limit).</summary>
    private static FlowVersion Snapshot(Flow flow, string note)
    {
        var version = new FlowVersion
        {
            Version = (flow.Versions.LastOrDefault()?.Version ?? 0) + 1,
            Note = TextLimits.Cut(note, 300) ?? "",
            CreatedAt = DateTimeOffset.UtcNow,
            Nodes = Clone(flow.Nodes),
            Edges = Clone(flow.Edges),
        };
        flow.Versions.Add(version);
        while (flow.Versions.Count > MaxVersions) flow.Versions.RemoveAt(1);
        return version;
    }

    private static void Say(Flow flow, string role, string text, int? version = null)
    {
        flow.Chat.Add(new FlowChatTurn { Id = Ids.New("msg"), Role = role, Text = TextLimits.Cut(text, TextLimits.Idea) ?? "", Version = version, CreatedAt = DateTimeOffset.UtcNow });
        while (flow.Chat.Count > MaxChatTurns) flow.Chat.RemoveAt(0);
    }

    /// <summary>A new flow made from a request starts its history: the request, what was made, and v1.</summary>
    private static void StartHistory(Flow flow, string? userMessage, string reply, string note)
    {
        var v1 = Snapshot(flow, note);
        if (!string.IsNullOrWhiteSpace(userMessage)) Say(flow, "user", userMessage);
        Say(flow, "assistant", reply, v1.Version);
    }

    /// <summary>Applies AI's card list: updates cards by id, adds new standalone outputs, removes outputs it left out. True when anything changed.</summary>
    private static bool Apply(Flow flow, FlowEdit edit)
    {
        if (edit.Cards.Count == 0) return false;
        var before = Shape(flow.Nodes, flow.Edges);
        var byId = flow.Nodes.ToDictionary(n => n.Id);
        var template = flow.Nodes.FirstOrDefault(n => n.Type == "output");
        var kept = new HashSet<string>();
        var added = new List<FlowNode>();

        foreach (var card in edit.Cards)
        {
            if (card.Id is not null && byId.TryGetValue(card.Id, out var node))
            {
                kept.Add(node.Id);
                if (card.Title.Length > 0) node.Data.Title = card.Title;
                if (card.Prompt.Length > 0 || node.Type == "prompt") node.Data.Prompt = card.Prompt.Length > 0 ? card.Prompt : node.Data.Prompt;
                if (node.Type != "output") continue;
                if (card.Ratio is not null) node.Data.Ratio = card.Ratio;
                if (card.Count is not null) node.Data.Count = card.Count;
                var kind = node.Data.Mode == "video" ? ModelKind.Video : ModelKind.Image;
                if (card.Model is not null && ModelCatalog.Find(kind, card.Model) is { } m) node.Data.Model = m.Id;
            }
            else if (card.Prompt.Length > 0 && flow.Nodes.Count + added.Count < FlowEditor.MaxCards)
            {
                // A new image: a standalone output card like the others (same kind, size, model, photo).
                var d = template?.Data;
                var mode = d?.Mode == "video" ? "video" : "image";
                var kind = mode == "video" ? ModelKind.Video : ModelKind.Image;
                var slot = flow.Nodes.Count(n => n.Type == "output") + added.Count;
                added.Add(new FlowNode
                {
                    Id = Ids.New("out"),
                    Type = "output",
                    Position = new FlowPosition { X = (flow.Nodes.Count == 0 ? 0 : flow.Nodes.Min(n => n.Position.X)) + slot % 3 * 320, Y = (flow.Nodes.Count == 0 ? 0 : flow.Nodes.Min(n => n.Position.Y)) + slot / 3 * 560 },
                    Data = new FlowStepData
                    {
                        Kind = "output", Title = card.Title.Length > 0 ? card.Title : $"Output {slot + 1}", Prompt = card.Prompt,
                        Attachments = d?.Attachments?.Where(a => a.Kind == "image").Select(a => new FlowAttachment { Id = Ids.New("att"), Name = a.Name, Kind = a.Kind, Size = a.Size, Url = a.Url }).ToList() ?? [],
                        Mode = mode, Ratio = card.Ratio ?? d?.Ratio ?? (mode == "video" ? "9:16" : "4:5"), Count = card.Count ?? 1,
                        Quality = d?.Quality ?? "standard", BrandKitId = d?.BrandKitId ?? "primary",
                        Model = card.Model is not null && ModelCatalog.Find(kind, card.Model) is { } m ? m.Id : d?.Model ?? (mode == "video" ? ModelCatalog.DefaultVideoModel : ModelCatalog.DefaultImageModel),
                    },
                });
            }
        }

        // Output cards AI left out are removed; prompt steps always stay.
        var removed = flow.Nodes.Where(n => n.Type == "output" && !kept.Contains(n.Id)).Select(n => n.Id).ToHashSet();
        if (removed.Count == flow.Nodes.Count(n => n.Type == "output") && added.Count == 0) removed.Clear(); // never empty the flow by accident
        flow.Nodes = [.. flow.Nodes.Where(n => !removed.Contains(n.Id)), .. added];
        flow.Edges = [.. flow.Edges.Where(e => !removed.Contains(e.Source) && !removed.Contains(e.Target))];
        return Shape(flow.Nodes, flow.Edges) != before;
    }

    /// <summary>
    /// A flow of standalone output cards, one per prompt (its own prompt, the product photo when given), side by side
    /// three to a row. `model` per item: the image/video model the prompt was written for, when this install has it.
    /// </summary>
    private static Flow CardsFlow(string userId, string workspaceId, string name, string mode, string ratio,
        IEnumerable<(string Title, string Prompt, string? Model, string? Photo)> items)
    {
        var kind = mode == "video" ? ModelKind.Video : ModelKind.Image;
        var nodes = items.Select((item, i) => new FlowNode
        {
            Id = Ids.New("out"),
            Type = "output",
            Position = new FlowPosition { X = i % 3 * 320, Y = i / 3 * 560 },
            Data = new FlowStepData
            {
                Kind = "output", Title = TextLimits.Cut(item.Title, 80) ?? $"Output {i + 1}", Prompt = TextLimits.Cut(item.Prompt, FlowFiles.MaxPromptLength),
                Attachments = item.Photo is null ? [] : [new FlowAttachment { Id = Ids.New("att"), Name = "Product photo", Kind = "image", Url = item.Photo }],
                Mode = mode == "video" ? "video" : "image", Ratio = ratio, Count = 1, Quality = "standard", BrandKitId = "primary",
                Model = ModelCatalog.Find(kind, item.Model) is { } m && !string.IsNullOrWhiteSpace(item.Model) ? m.Id
                    : kind == ModelKind.Video ? ModelCatalog.DefaultVideoModel : ModelCatalog.DefaultImageModel,
            },
        }).ToList();
        var now = DateTimeOffset.UtcNow;
        return new Flow
        {
            Id = Ids.New("flow"),
            UserId = userId,
            WorkspaceId = workspaceId,
            Name = TextLimits.Cut(name, 80) ?? "Prompt flow",
            Nodes = nodes,
            Edges = [],
            CreatedAt = now,
            UpdatedAt = now,
        };
    }
}
