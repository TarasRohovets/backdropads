using BackdropAds.Api.Data;
using BackdropAds.Api.Domain;
using BackdropAds.Api.Services;

namespace BackdropAds.Api.Endpoints;

public class SavePromptRequest
{
    public string? Title { get; set; }
    public string? Text { get; set; }
    public string? Kind { get; set; }
}

/// <summary>"Write with AI" on the Prompts page.</summary>
public class ComposePromptsRequest
{
    public string? Message { get; set; }
    /// <summary>"image" | "video"; null = decide from the message (or from the target model).</summary>
    public string? Mode { get; set; }
    /// <summary>The ModelCatalog image/video model to write for ("nano-banana-pro"); null or "auto" = any.</summary>
    public string? TargetModel { get; set; }
    /// <summary>The Claude model that writes them (Sonnet by default; Opus or Fable when picked).</summary>
    public string? TextModel { get; set; }
}

public class RenamePromptGroupRequest
{
    public string? Name { get; set; }
}

public class ImprovePromptRequest
{
    public string? Idea { get; set; }
    public string? Mode { get; set; }
    public string? AspectRatio { get; set; }
    public string? Platform { get; set; }
    /// <summary>ModelCatalog id; its display name is passed to the writer.</summary>
    public string? Model { get; set; }
    public int? DurationSeconds { get; set; }
    public string? ProductName { get; set; }
    public bool HasProductPhoto { get; set; }
    /// <summary>"primary", a bk_ id, or "none".</summary>
    public string? BrandKitId { get; set; }
    /// <summary>The Claude model to write with (Opus or Fable when picked); null = the standard one.</summary>
    public string? TextModel { get; set; }
}

/// <summary>The saved-prompts library, and "Improve with AI" (free, rate-limited).</summary>
public static class PromptEndpoints
{
    private const int MaxPrompts = 500;
    private const int MaxTitle = 80;
    private const int MaxText = 4000;
    private const int MaxIdea = 2000;

    public static IEndpointRouteBuilder MapPromptEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/prompts").WithTags("Prompts");

        group.MapGet("/", (AppStore store, IUserContext userContext) => Results.Ok(store.ListPrompts(userContext.WorkspaceId)));

        group.MapPost("/", (SavePromptRequest request, AppStore store, IUserContext userContext) =>
        {
            if (Validate(request, requireAll: true) is { } problem) return problem;
            if (store.CountPrompts(userContext.WorkspaceId) >= MaxPrompts)
                return Results.BadRequest(new { error = $"That's the limit of {MaxPrompts} saved prompts. Delete some first." });
            var now = DateTimeOffset.UtcNow;
            var text = request.Text!.Trim();
            var prompt = store.AddPrompt(new SavedPrompt
            {
                Id = Ids.New("prm"),
                WorkspaceId = userContext.WorkspaceId,
                UserId = userContext.UserId,
                Title = CleanTitle(request.Title) ?? TitleFrom(text),
                Text = text,
                Kind = request.Kind == "video" ? "video" : "image",
                CreatedAt = now,
                UpdatedAt = now,
            });
            return Results.Created($"/api/prompts/{prompt.Id}", prompt);
        });

        group.MapPut("/{id}", (string id, SavePromptRequest request, AppStore store, IUserContext userContext) =>
        {
            var prompt = store.GetPrompt(id, userContext.WorkspaceId);
            if (prompt is null) return Results.NotFound(new { error = "Prompt not found." });
            if (Validate(request, requireAll: false) is { } problem) return problem;
            if (request.Title is not null) prompt.Title = CleanTitle(request.Title) ?? prompt.Title;
            if (request.Text is not null) prompt.Text = request.Text.Trim();
            if (request.Kind is not null) prompt.Kind = request.Kind == "video" ? "video" : "image";
            prompt.UpdatedAt = DateTimeOffset.UtcNow;
            store.UpdatePrompt(prompt);
            return Results.Ok(prompt);
        });

        // "Write with AI": one message ("3 photos: x, y, z") → a group of prompts written for the chosen image or video
        // model, with your Anthropic key. The group can go to Flows (one image each), or any prompt to Create.
        group.MapPost("/compose", async (ComposePromptsRequest request, AppStore store, IUserContext userContext,
            AiTextGate gate, FlowComposer composer, CancellationToken ct) =>
        {
            var message = request.Message?.Trim() ?? "";
            if (message.Length < 5) return Results.BadRequest(new { error = "Tell us what you need — a sentence is enough." });
            if (message.Length > TextLimits.Idea) return Results.BadRequest(new { error = $"Keep it under {TextLimits.Idea:N0} characters." });
            var mode = request.Mode is "image" or "video" ? request.Mode : null;
            AiModel? target = null;
            if (!string.IsNullOrWhiteSpace(request.TargetModel) && request.TargetModel != ModelCatalog.Auto)
            {
                target = ModelCatalog.Find(mode == "video" ? ModelKind.Video : ModelKind.Image, request.TargetModel)
                         ?? ModelCatalog.Find(mode == "video" ? ModelKind.Image : ModelKind.Video, request.TargetModel);
                if (target is null) return Results.BadRequest(new { error = "Unknown image or video model." });
                mode ??= target.Kind == ModelKind.Video ? "video" : "image";
            }
            if (store.CountPrompts(userContext.WorkspaceId) + FlowComposer.MaxImages > MaxPrompts)
                return Results.BadRequest(new { error = $"That's close to the limit of {MaxPrompts} saved prompts. Delete some first." });

            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();
            var (ticket, refusal) = await gate.OpenAsync(user, request.TextModel);
            if (refusal is not null) return refusal;

            ComposedFlow plan;
            try
            {
                var brand = store.FindBrandKit(userContext.WorkspaceId, "primary")?.BrandName;
                plan = await composer.ComposeAsync(message, 0, [], brand, ticket!.Model.Id, ct, mode, target?.Name);
            }
            catch (OperationCanceledException)
            {
                await gate.CancelAsync(ticket!);
                throw;
            }
            var (used, limit) = await gate.CloseAsync(ticket, plan.ByAi, plan.Model, plan.CostUsd);

            // The target model only sticks when it makes what the plan makes (an image model for image prompts).
            var targetId = target is not null && (target.Kind == ModelKind.Video) == (plan.Mode == "video") ? target.Id : null;
            var now = DateTimeOffset.UtcNow;
            var promptGroup = new PromptGroup
            {
                Id = Ids.New("pgr"),
                WorkspaceId = userContext.WorkspaceId,
                UserId = user.Id,
                Name = TextLimits.Cut(plan.Name, MaxTitle) ?? "Prompt group",
                Kind = plan.Mode,
                Ratio = plan.Ratio,
                TargetModel = targetId,
                Message = message,
                CreatedAt = now,
            };
            var prompts = plan.Items.Select((item, i) => new SavedPrompt
            {
                Id = Ids.New("prm"),
                WorkspaceId = userContext.WorkspaceId,
                UserId = user.Id,
                Title = CleanTitle(item.Title) ?? $"Prompt {i + 1}",
                Text = TextLimits.Cut(item.Prompt, MaxText)!,
                Kind = plan.Mode,
                TargetModel = targetId,
                GroupId = promptGroup.Id,
                Position = i,
                CreatedAt = now.AddMilliseconds(i),
                UpdatedAt = now.AddMilliseconds(i),
            }).ToList();
            store.AddPromptGroup(promptGroup, prompts);
            return Results.Created($"/api/prompts/groups/{promptGroup.Id}", new
            {
                group = GroupView(promptGroup, prompts),
                byAi = plan.ByAi,
                model = plan.ByAi && plan.Model is not null ? AiPlans.NameOf(plan.Model) : null,
                used,
                limit,
            });
        });

        // Groups with their prompts, newest first.
        group.MapGet("/groups", (AppStore store, IUserContext userContext) =>
        {
            var prompts = store.ListPrompts(userContext.WorkspaceId).Where(p => p.GroupId is not null).ToLookup(p => p.GroupId!);
            return Results.Ok(store.ListPromptGroups(userContext.WorkspaceId)
                .Select(g => GroupView(g, prompts[g.Id].OrderBy(p => p.Position).ThenBy(p => p.CreatedAt).ToList())));
        });

        group.MapPut("/groups/{id}", (string id, RenamePromptGroupRequest request, AppStore store, IUserContext userContext) =>
        {
            if (CleanTitle(request.Name) is not { } name) return Results.BadRequest(new { error = "Give the group a name." });
            return store.RenamePromptGroup(id, userContext.WorkspaceId, name)
                ? Results.Ok(new { id, name })
                : Results.NotFound(new { error = "Prompt group not found." });
        });

        // Deletes the group and its prompts.
        group.MapDelete("/groups/{id}", (string id, AppStore store, IUserContext userContext) =>
            store.RemovePromptGroup(id, userContext.WorkspaceId) ? Results.NoContent() : Results.NotFound(new { error = "Prompt group not found." }));

        // Counts a use when a saved prompt is put into Create (so the most used rise to the top).
        group.MapPost("/{id}/use", (string id, AppStore store, IUserContext userContext) =>
            store.MarkPromptUsed(id, userContext.WorkspaceId) is { } p ? Results.Ok(p) : Results.NotFound(new { error = "Prompt not found." }));

        group.MapDelete("/{id}", (string id, AppStore store, IUserContext userContext) =>
            store.RemovePrompt(id, userContext.WorkspaceId) ? Results.NoContent() : Results.NotFound(new { error = "Prompt not found." }));

        // The Claude models for text work (for the picker). Self-hosted with your own key: all of them, no monthly limit.
        group.MapGet("/ai", (ClaudeText claude) => Results.Ok(new
        {
            plan = "self-hosted",
            admin = true,
            live = claude.Live,
            models = AiPlans.Models(claude.Model).Select(m => new { m.Id, m.Name, m.Units, available = true }),
            defaultModel = claude.Model,
            used = 0,
            limit = 0, // 0 = no monthly limit
            renewsAt = (DateTimeOffset?)null,
        }));

        // "Improve with AI": rough idea → a prompt written for image or video models. Uses your Anthropic key;
        // capped per hour and day (RateLimits) to protect your bill.
        group.MapPost("/improve", async (ImprovePromptRequest request, AppStore store, IUserContext userContext,
            AiTextGate gate, PromptWriter writer, CancellationToken ct) =>
        {
            var idea = request.Idea?.Trim() ?? "";
            if (idea.Length < 3) return Results.BadRequest(new { error = "Write a few words about the ad you want first." });
            if (idea.Length > MaxIdea) return Results.BadRequest(new { error = $"Keep it under {MaxIdea} characters." });

            var user = store.GetUser(userContext.UserId);
            if (user is null) return Results.Unauthorized();
            var (ticket, refusal) = await gate.OpenAsync(user, request.TextModel);
            if (refusal is not null) return refusal;

            var mode = request.Mode == "video" ? "video" : "image";
            var model = string.IsNullOrWhiteSpace(request.Model) ? null
                : ModelCatalog.All.FirstOrDefault(m => m.Id == request.Model)?.Name;
            BrandKit? kit = string.Equals(request.BrandKitId, "none", StringComparison.OrdinalIgnoreCase) ? null
                : store.FindBrandKit(userContext.WorkspaceId, string.IsNullOrWhiteSpace(request.BrandKitId) ? "primary" : request.BrandKitId);

            WrittenPrompt written;
            try
            {
                written = await writer.WriteAsync(new PromptBrief(
                idea, mode, Short(request.AspectRatio, 8), Short(request.Platform, 20), model,
                request.DurationSeconds is > 0 and <= 120 ? request.DurationSeconds : null,
                Short(request.ProductName, 120), request.HasProductPhoto,
                Short(kit?.BrandName, 80), kit?.Colors, Short(kit?.Tone, 120)), ticket!.Model.Id, ct);
            }
            catch (OperationCanceledException)
            {
                await gate.CancelAsync(ticket!);
                throw;
            }
            var (used, limit) = await gate.CloseAsync(ticket, written.ByAi, written.Model, written.CostUsd);
            return Results.Ok(new
            {
                title = written.Title,
                prompt = written.Prompt,
                byAi = written.ByAi,
                model = written.ByAi ? AiPlans.NameOf(written.Model!) : null,
                used,
                limit,
            });
        });

        return app;
    }

    private static object GroupView(PromptGroup g, List<SavedPrompt> prompts) => new
    {
        g.Id,
        g.Name,
        g.Kind,
        g.Ratio,
        g.TargetModel,
        targetModelName = string.IsNullOrWhiteSpace(g.TargetModel) ? null
            : ModelCatalog.Find(g.Kind == "video" ? ModelKind.Video : ModelKind.Image, g.TargetModel)?.Name,
        g.Message,
        g.CreatedAt,
        prompts,
    };

    private static IResult? Validate(SavePromptRequest r, bool requireAll)
    {
        if ((requireAll || r.Text is not null) && string.IsNullOrWhiteSpace(r.Text))
            return Results.BadRequest(new { error = "The prompt is empty." });
        if (r.Text is { Length: > MaxText })
            return Results.BadRequest(new { error = $"Keep prompts under {MaxText} characters." });
        if (r.Kind is not null and not ("image" or "video"))
            return Results.BadRequest(new { error = "Kind must be image or video." });
        return null;
    }

    private static string? CleanTitle(string? title)
    {
        var t = string.Join(' ', (title ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        return t.Length == 0 ? null : t.Length <= MaxTitle ? t : t[..MaxTitle].TrimEnd();
    }

    private static string TitleFrom(string text)
    {
        var t = string.Join(' ', text.Split((char[])[' ', '\n', '\r', '\t'], StringSplitOptions.RemoveEmptyEntries).Take(6)).Trim(',', '.', ';', ':');
        return t.Length <= MaxTitle ? t : t[..MaxTitle];
    }

    private static string? Short(string? s, int max) =>
        string.IsNullOrWhiteSpace(s) ? null : s.Trim().Length <= max ? s.Trim() : s.Trim()[..max];
}
