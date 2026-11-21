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

        group.MapGet("/", (AppStore store, IUserContext user) =>
            Results.Ok(store.ListFlows(user.WorkspaceId)));

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
}
