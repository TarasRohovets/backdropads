using System.Data;
using BackdropAds.Api.Domain;
using BackdropAds.Api.Services;
using BackdropAds.Api.Services.Providers;
using Dapper;
using Npgsql;

namespace BackdropAds.Api.Data;

/// <summary>
/// Persistence for everything (workspaces and their content) on Dapper + PostgreSQL.
/// Scoped: one connection per request. Entities it returns are tracked, so endpoints can edit them in place;
/// <see cref="SaveChangesFilter"/> calls <see cref="Save"/> (writes whatever changed) before the response is sent.
/// Generations/analyses "complete on read" (6s/5s), claimed atomically so they complete once.
/// </summary>
public sealed partial class AppStore(
    DbContext dbContext,
    IAdGenerationService generationService,
    IAdAnalysisService analysisService,
    ProviderRouter providerRouter,
    DocumentReader documentReader) : IDisposable
{
    private static readonly TimeSpan GenerationDelay = TimeSpan.FromSeconds(6);
    private static readonly TimeSpan RoastDelay = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan ClaimTimeout = TimeSpan.FromMinutes(15);

    private NpgsqlConnection? _connection;

    private NpgsqlConnection Db
    {
        get
        {
            if (_connection is null)
            {
                _connection = dbContext.CreateConnection();
                _connection.Open();
            }
            return _connection;
        }
    }

    public void Dispose() => _connection?.Dispose();

    // ---- Change tracking -------------------------------------------------------
    // Every entity handed out is remembered with a JSON snapshot; Save() writes the ones that changed.
    // Loading the same row twice in a request returns the same instance (so edits never fight).

    private sealed class Tracked(object entity, Action save)
    {
        public object Entity { get; set; } = entity;
        public Action Write { get; set; } = save;
        public string Snapshot { get; set; } = JsonColumns.Serialize(entity);
    }

    private readonly Dictionary<string, Tracked> _tracked = new();

    private static string Key<T>(string id) => $"{typeof(T).Name}:{id}";

    private T Track<T>(T entity, string id, Action<T> write) where T : class
    {
        if (_tracked.TryGetValue(Key<T>(id), out var existing)) return (T)existing.Entity;
        _tracked[Key<T>(id)] = new Tracked(entity, () => write(entity));
        return entity;
    }

    /// <summary>Track a row that was just written: replaces any older instance and marks it saved.</summary>
    private T Retrack<T>(T entity, string id, Action<T> write) where T : class
    {
        _tracked[Key<T>(id)] = new Tracked(entity, () => write(entity));
        return entity;
    }

    private T? Cached<T>(string id) where T : class =>
        _tracked.TryGetValue(Key<T>(id), out var t) ? (T)t.Entity : null;

    private void Untrack<T>(string id) => _tracked.Remove(Key<T>(id));

    /// <summary>Writes every tracked entity that changed since it was loaded or last saved.</summary>
    public void Save()
    {
        foreach (var t in _tracked.Values)
        {
            var now = JsonColumns.Serialize(t.Entity);
            if (now == t.Snapshot) continue;
            t.Write();
            t.Snapshot = now;
        }
    }

    public bool CanConnect()
    {
        try { return Db.ExecuteScalar<int>("SELECT 1") == 1; }
        catch (Exception) { return false; }
    }

    // ---- The instance's user ---------------------------------------------------

    public User? GetUser(string id) =>
        Cached<User>(id) ?? (Db.QuerySingleOrDefault<User>("SELECT * FROM backdropads.users WHERE id = @id", new { id }) is { } u
            ? Track(u, u.Id, _ => { })
            : null);

    /// <summary>
    /// Returns the id of the instance's user, creating it (with its first workspace) on first start.
    /// The advisory lock makes two instances starting together safe.
    /// </summary>
    public string EnsureLocalUser()
    {
        using var tx = Db.BeginTransaction();
        Db.Execute("SELECT pg_advisory_xact_lock(7311001)", transaction: tx);
        var id = Db.QueryFirstOrDefault<string>("SELECT id FROM backdropads.users ORDER BY created_at LIMIT 1", transaction: tx);
        if (id is null)
        {
            id = "usr_local";
            var now = DateTimeOffset.UtcNow;
            Db.Execute("INSERT INTO backdropads.users (id, name, created_at) VALUES (@id, 'Owner', @now)", new { id, now }, tx);
            InsertWorkspace(new Workspace { Id = Ids.New("ws"), OwnerId = id, Name = "My store", CreatedAt = now }, tx);
        }
        tx.Commit();
        return id;
    }

    // ---- Content documents (key columns + full object as jsonb) ---------------------

    private List<T> LoadDocs<T>(string sql, object args) =>
        [.. Db.Query<string>(sql, args).Select(JsonColumns.Deserialize<T>)];

    private void UpsertDoc(string table, string sortColumn, string id, string workspaceId, string userId, DateTimeOffset sortAt, object entity) =>
        Db.Execute($"""
            INSERT INTO backdropads.{table} (id, workspace_id, user_id, {sortColumn}, data)
            VALUES (@id, @workspaceId, @userId, @sortAt, CAST(@data AS jsonb))
            ON CONFLICT (id) DO UPDATE SET {sortColumn} = excluded.{sortColumn}, data = excluded.data
            """, new { id, workspaceId, userId, sortAt, data = JsonColumns.Serialize(entity) });

    // ---- Generations -------------------------------------------------------

    private void WriteGeneration(Generation g) => Db.Execute("""
        INSERT INTO backdropads.generations (id, workspace_id, user_id, status, creative_type, created_at, data)
        VALUES (@Id, @WorkspaceId, @UserId, @Status, @CreativeType, @CreatedAt, CAST(@Data AS jsonb))
        ON CONFLICT (id) DO UPDATE SET status = excluded.status, creative_type = excluded.creative_type, data = excluded.data
        """, new
    {
        g.Id,
        g.WorkspaceId,
        g.UserId,
        Status = g.Status.ToString(),
        CreativeType = g.CreativeType.ToString(),
        g.CreatedAt,
        Data = JsonColumns.Serialize(g),
    });

    private Generation TrackGeneration(Generation g) => Track(g, g.Id, WriteGeneration);

    public Generation AddGeneration(Generation generation)
    {
        // Every way in (Create, flows, templates) is cut to the text limits before any AI sees it.
        TextLimits.Apply(generation.Brief);
        WriteGeneration(generation); // pollers (other requests, the flow runner) see it right away
        return Retrack(generation, generation.Id, WriteGeneration);
    }

    public Generation? GetGeneration(string id, string workspaceId)
    {
        var generation = Cached<Generation>(id) is { } t
            ? (t.WorkspaceId == workspaceId ? t : null)
            : LoadDocs<Generation>("SELECT data::text FROM backdropads.generations WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId })
                .Select(TrackGeneration).FirstOrDefault();
        if (generation is not null) MaybeComplete(generation);
        return generation;
    }

    public List<Generation> ListGenerations(string workspaceId)
    {
        var all = LoadDocs<Generation>(
            "SELECT data::text FROM backdropads.generations WHERE workspace_id = @workspaceId ORDER BY created_at DESC LIMIT 200",
            new { workspaceId }).Select(TrackGeneration).ToList();
        foreach (var generation in all) MaybeComplete(generation);
        return all;
    }

    /// <summary>Deletes a whole generation (used when its last concept is removed).</summary>
    public bool RemoveGeneration(string id, string workspaceId)
    {
        Untrack<Generation>(id);
        return Db.Execute("DELETE FROM backdropads.generations WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId }) > 0;
    }

    /// <summary>True when any saved record (generation, ad, flow, product, upload) still points at this media URL.</summary>
    public bool IsMediaReferenced(string url) => Db.ExecuteScalar<bool>("""
        SELECT EXISTS (SELECT 1 FROM backdropads.generations WHERE strpos(data::text, @url) > 0)
            OR EXISTS (SELECT 1 FROM backdropads.ads WHERE strpos(data::text, @url) > 0)
            OR EXISTS (SELECT 1 FROM backdropads.flows WHERE strpos(data::text, @url) > 0)
            OR EXISTS (SELECT 1 FROM backdropads.products WHERE strpos(data::text, @url) > 0)
            OR EXISTS (SELECT 1 FROM backdropads.uploads WHERE url = @url)
        """, new { url });

    /// <summary>Concurrency guard: processing generations of the given kind owned by the user.</summary>
    public int CountProcessingGenerations(string userId, bool video)
    {
        var processing = LoadDocs<Generation>("""
            SELECT data::text FROM backdropads.generations
            WHERE user_id = @userId AND status = 'Processing' AND (creative_type = 'Video') = @video
            """, new { userId, video }).Select(TrackGeneration).ToList();
        foreach (var generation in processing) MaybeComplete(generation); // stale entries complete here, like on any read
        return processing.Count(g => g.Status == GenerationStatus.Processing);
    }

    private void MaybeComplete(Generation generation)
    {
        var now = DateTimeOffset.UtcNow;
        if (generation.Status != GenerationStatus.Processing || now - generation.CreatedAt < GenerationDelay) return;

        // Atomic claim: exactly one request (on any instance) runs the providers.
        var claimed = Db.Execute("""
            UPDATE backdropads.generations SET claimed_at = @now
            WHERE id = @id AND status = 'Processing' AND (claimed_at IS NULL OR claimed_at < @staleBefore)
            """, new { id = generation.Id, now, staleBefore = now - ClaimTimeout });
        if (claimed == 0) return;
        generation.ClaimedAt = now;

        // PDFs / text: the LLM reads them first; its notes become part of the prompt (never the files themselves).
        if (generation.Brief.DocumentUrls.Count > 0 && generation.Brief.DocumentNotes is null)
            generation.Brief.DocumentNotes = documentReader
                .DigestAsync(generation.Brief.DocumentUrls, generation.Brief.ProductDescription).GetAwaiter().GetResult() ?? "";

        generation.Concepts = generationService.GenerateConcepts(generation);

        // Provider chain (mock by default). Sync-over-async is safe here: with AI:UseMockData=true the
        // router completes synchronously, and real providers are fallback-guarded so the task always resolves.
        var media = new List<GeneratedMedia>();
        foreach (var concept in generation.Concepts)
        {
            var result = providerRouter.GenerateAsync(generation, concept).GetAwaiter().GetResult();
            concept.Model = result.Model;
            concept.MediaUrl = result.Url;
            if (!string.IsNullOrWhiteSpace(result.ImageSeed)) concept.ImageSeed = result.ImageSeed!;
            if (result.DurationSeconds is { } seconds && concept.Video is not null) concept.Video.DurationSeconds = seconds;
            media.Add(result);
        }

        generation.EstimatedCostUsd = EstimateCost(generation, media);

        // Never show placeholders: keep what really worked; if nothing did, the generation failed.
        var failed = media.Count(m => m.IsFallback);
        generation.Status = GenerationStatus.Completed;
        if (failed > 0)
        {
            var isVideo = generation.CreativeType == CreativeType.Video;
            var kept = generation.Concepts.Where((_, i) => !media[i].IsFallback).ToList();
            var picked = ModelCatalog.Find(isVideo ? ModelKind.Video : ModelKind.Image, generation.Model) is { } m && m.Id != ModelCatalog.Auto ? m : null;
            generation.SuggestedModel = providerRouter.SuggestAlternative(generation);
            generation.Concepts = kept;
            if (kept.Count == 0)
            {
                generation.Status = GenerationStatus.Failed;
                generation.Error = picked is not null
                    ? $"{picked.Name} isn't responding right now."
                    : $"No {(isVideo ? "video" : "image")} model is responding right now. Check your API keys in Settings.";
            }
            else
            {
                generation.Error = $"{failed} of {media.Count} {(isVideo ? "videos" : "images")} couldn't be made.";
            }
        }
        Save();
    }

    /// <summary>
    /// What this generation cost at the providers' list prices, counting only the work that really ran
    /// (failed attempts and mock results cost nothing). An estimate — your provider's invoice is the truth.
    /// </summary>
    private static decimal EstimateCost(Generation generation, List<GeneratedMedia> media)
    {
        var kind = generation.CreativeType == CreativeType.Video ? ModelKind.Video : ModelKind.Image;
        var picked = ModelCatalog.Find(kind, generation.Model) ?? ModelCatalog.Default(kind);
        var total = 0m;
        foreach (var m in media)
        {
            if (m.IsFallback || m.Provider == "mock") continue;
            var used = ModelCatalog.Find(kind, m.Provider) ?? picked;
            var seconds = kind == ModelKind.Video ? m.DurationSeconds ?? generation.DurationSeconds ?? used.DefaultDuration : 0;
            total += ModelCatalog.UnitCostUsd(used, generation.Quality, seconds);
        }
        return total;
    }

    // ---- Ads ---------------------------------------------------------------

    private void WriteAd(Ad a) => UpsertDoc("ads", "created_at", a.Id, a.WorkspaceId, a.UserId, a.CreatedAt, a);

    public Ad AddAd(Ad ad)
    {
        WriteAd(ad);
        return Retrack(ad, ad.Id, WriteAd);
    }

    public Ad? GetAd(string id, string workspaceId) =>
        Cached<Ad>(id) is { } t
            ? (t.WorkspaceId == workspaceId ? t : null)
            : LoadDocs<Ad>("SELECT data::text FROM backdropads.ads WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId })
                .Select(a => Track(a, a.Id, WriteAd)).FirstOrDefault();

    public List<Ad> ListAds(string workspaceId) =>
        [.. LoadDocs<Ad>("SELECT data::text FROM backdropads.ads WHERE workspace_id = @workspaceId ORDER BY created_at DESC", new { workspaceId })
            .Select(a => Track(a, a.Id, WriteAd))];

    public bool RemoveAd(string id, string workspaceId)
    {
        Untrack<Ad>(id);
        return Db.Execute("DELETE FROM backdropads.ads WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId }) > 0;
    }

    // ---- Flows -------------------------------------------------------------

    private void WriteFlow(Flow f) => UpsertDoc("flows", "updated_at", f.Id, f.WorkspaceId, f.UserId, f.UpdatedAt, f);

    public Flow AddFlow(Flow flow)
    {
        WriteFlow(flow);
        return Retrack(flow, flow.Id, WriteFlow);
    }

    public Flow? GetFlow(string id, string workspaceId) =>
        GetFlowById(id) is { } flow && flow.WorkspaceId == workspaceId ? flow : null;

    /// <summary>Background runner only (already authorised when the run started).</summary>
    public Flow? GetFlowById(string id) =>
        Cached<Flow>(id) ?? LoadDocs<Flow>("SELECT data::text FROM backdropads.flows WHERE id = @id", new { id })
            .Select(f => Track(f, f.Id, WriteFlow)).FirstOrDefault();

    public List<Flow> ListFlows(string workspaceId) =>
        [.. LoadDocs<Flow>("SELECT data::text FROM backdropads.flows WHERE workspace_id = @workspaceId ORDER BY updated_at DESC", new { workspaceId })
            .Select(f => Track(f, f.Id, WriteFlow))];

    public bool RemoveFlow(string id, string workspaceId)
    {
        Untrack<Flow>(id);
        return Db.Execute("DELETE FROM backdropads.flows WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId }) > 0;
    }

    // ---- Products ----------------------------------------------------------

    private void WriteProduct(Product p) => UpsertDoc("products", "created_at", p.Id, p.WorkspaceId, p.UserId, p.CreatedAt, p);

    public Product AddProduct(Product product)
    {
        WriteProduct(product);
        return Retrack(product, product.Id, WriteProduct);
    }

    public Product? GetProduct(string id, string workspaceId) =>
        Cached<Product>(id) is { } t
            ? (t.WorkspaceId == workspaceId ? t : null)
            : LoadDocs<Product>("SELECT data::text FROM backdropads.products WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId })
                .Select(p => Track(p, p.Id, WriteProduct)).FirstOrDefault();

    public List<Product> ListProducts(string workspaceId) =>
        [.. LoadDocs<Product>("SELECT data::text FROM backdropads.products WHERE workspace_id = @workspaceId ORDER BY created_at DESC", new { workspaceId })
            .Select(p => Track(p, p.Id, WriteProduct))];

    public bool RemoveProduct(string id, string workspaceId)
    {
        Untrack<Product>(id);
        return Db.Execute("DELETE FROM backdropads.products WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId }) > 0;
    }

    // ---- Roasts (analyses) ---------------------------------------------------

    private void WriteRoast(Roast r) => UpsertDoc("analyses", "created_at", r.Id, r.WorkspaceId, r.UserId, r.CreatedAt, r);

    public Roast AddRoast(Roast roast)
    {
        WriteRoast(roast);
        return Retrack(roast, roast.Id, WriteRoast);
    }

    public Roast? GetRoast(string id, string workspaceId)
    {
        var roast = Cached<Roast>(id) is { } t
            ? (t.WorkspaceId == workspaceId ? t : null)
            : LoadDocs<Roast>("SELECT data::text FROM backdropads.analyses WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId })
                .Select(r => Track(r, r.Id, WriteRoast)).FirstOrDefault();
        if (roast is not null) MaybeComplete(roast);
        return roast;
    }

    public List<Roast> ListRoasts(string workspaceId)
    {
        var all = LoadDocs<Roast>("SELECT data::text FROM backdropads.analyses WHERE workspace_id = @workspaceId ORDER BY created_at DESC", new { workspaceId })
            .Select(r => Track(r, r.Id, WriteRoast)).ToList();
        foreach (var roast in all) MaybeComplete(roast);
        return all;
    }

    /// <summary>Forces completion regardless of elapsed time (used by the improve flow).</summary>
    public void EnsureRoastCompleted(Roast roast)
    {
        if (roast.Status == GenerationStatus.Processing) analysisService.CompleteRoast(roast);
    }

    private void MaybeComplete(Roast roast)
    {
        // Deterministic per roast id, so a concurrent double-completion writes the same result.
        if (roast.Status == GenerationStatus.Processing && DateTimeOffset.UtcNow - roast.CreatedAt >= RoastDelay)
            analysisService.CompleteRoast(roast);
    }

    // ---- Workspaces --------------------------------------------------------

    private void WriteWorkspace(Workspace w) =>
        Db.Execute("UPDATE backdropads.workspaces SET name = @Name WHERE id = @Id", new { w.Id, w.Name });

    private void InsertWorkspace(Workspace w, IDbTransaction? tx = null) => Db.Execute(
        "INSERT INTO backdropads.workspaces (id, owner_id, name, created_at) VALUES (@Id, @OwnerId, @Name, @CreatedAt)", w, tx);

    public List<Workspace> ListWorkspaces(string ownerId) =>
        [.. Db.Query<Workspace>("SELECT * FROM backdropads.workspaces WHERE owner_id = @ownerId ORDER BY created_at", new { ownerId })
            .Select(w => Track(w, w.Id, WriteWorkspace))];

    public Workspace? GetWorkspace(string id, string ownerId) =>
        Cached<Workspace>(id) is { } t
            ? (t.OwnerId == ownerId ? t : null)
            : Db.QuerySingleOrDefault<Workspace>("SELECT * FROM backdropads.workspaces WHERE id = @id AND owner_id = @ownerId", new { id, ownerId }) is { } w
                ? Track(w, w.Id, WriteWorkspace)
                : null;

    public Workspace AddWorkspace(Workspace workspace)
    {
        InsertWorkspace(workspace);
        return Retrack(workspace, workspace.Id, WriteWorkspace);
    }

    /// <summary>The account's first workspace, created on demand (every account always has one).</summary>
    public Workspace DefaultWorkspace(string ownerId) =>
        ListWorkspaces(ownerId).FirstOrDefault()
        ?? AddWorkspace(new Workspace { Id = Ids.New("ws"), OwnerId = ownerId, Name = "My store", CreatedAt = DateTimeOffset.UtcNow });

    /// <summary>Deletes a workspace and everything in it (ON DELETE CASCADE). Never the account's last one.</summary>
    public bool RemoveWorkspace(string id, string ownerId)
    {
        if (GetWorkspace(id, ownerId) is null || ListWorkspaces(ownerId).Count <= 1) return false;
        Untrack<Workspace>(id);
        return Db.Execute("DELETE FROM backdropads.workspaces WHERE id = @id AND owner_id = @ownerId", new { id, ownerId }) > 0;
    }

    // ---- Folders (organise saved ads) -----------------------------------------

    /// <summary>The workspace's folders in order; the first call ever also creates the starter set.</summary>
    public List<Folder> ListFolders(string workspaceId, string userId)
    {
        // Claim the one-time seeding atomically, so two first requests can't both add the starter folders.
        if (Db.Execute("UPDATE backdropads.workspaces SET folders_seeded = TRUE WHERE id = @workspaceId AND NOT folders_seeded", new { workspaceId }) == 1)
        {
            var now = DateTimeOffset.UtcNow;
            var i = 0;
            foreach (var (name, color) in FolderColors.Starter)
                InsertFolder(new Folder { Id = Ids.New("fld"), WorkspaceId = workspaceId, UserId = userId, Name = name, Color = color, Position = i++, CreatedAt = now });
        }
        return [.. Db.Query<Folder>("SELECT * FROM backdropads.folders WHERE workspace_id = @workspaceId ORDER BY position, created_at", new { workspaceId })];
    }

    public Folder? GetFolder(string id, string workspaceId) =>
        Db.QuerySingleOrDefault<Folder>("SELECT * FROM backdropads.folders WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId });

    public Folder AddFolder(string workspaceId, string userId, string? parentId, string name, string color)
    {
        var position = Db.ExecuteScalar<int>("SELECT COALESCE(MAX(position) + 1, 0) FROM backdropads.folders WHERE workspace_id = @workspaceId", new { workspaceId });
        var folder = new Folder { Id = Ids.New("fld"), WorkspaceId = workspaceId, UserId = userId, ParentId = parentId, Name = name, Color = color, Position = position, CreatedAt = DateTimeOffset.UtcNow };
        InsertFolder(folder);
        return folder;
    }

    private void InsertFolder(Folder f) => Db.Execute("""
        INSERT INTO backdropads.folders (id, workspace_id, user_id, parent_id, name, color, position, created_at)
        VALUES (@Id, @WorkspaceId, @UserId, @ParentId, @Name, @Color, @Position, @CreatedAt)
        """, f);

    public void UpdateFolder(Folder f) =>
        Db.Execute("UPDATE backdropads.folders SET name = @Name, color = @Color, parent_id = @ParentId WHERE id = @Id AND workspace_id = @WorkspaceId", f);

    /// <summary>Deletes the folder and its subfolders (ON DELETE CASCADE); their ads stay in My Ads, without a folder.</summary>
    public bool RemoveFolder(string id, string workspaceId)
    {
        var removed = Db.Query<string>("""
            WITH RECURSIVE branch AS (
                SELECT id FROM backdropads.folders WHERE id = @id AND workspace_id = @workspaceId
                UNION ALL
                SELECT f.id FROM backdropads.folders f JOIN branch b ON f.parent_id = b.id
            ) SELECT id FROM branch
            """, new { id, workspaceId }).ToHashSet();
        if (removed.Count == 0) return false;
        Db.Execute("DELETE FROM backdropads.folders WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId });
        foreach (var ad in ListAds(workspaceId).Where(a => a.FolderId is not null && removed.Contains(a.FolderId))) ad.FolderId = null;
        return true;
    }

    // ---- Saved prompts -------------------------------------------------------

    /// <summary>Most recently used (or edited) first.</summary>
    public List<SavedPrompt> ListPrompts(string workspaceId) =>
        [.. Db.Query<SavedPrompt>("""
            SELECT * FROM backdropads.prompts WHERE workspace_id = @workspaceId
            ORDER BY GREATEST(updated_at, COALESCE(last_used_at, updated_at)) DESC
            """, new { workspaceId })];

    public SavedPrompt? GetPrompt(string id, string workspaceId) =>
        Db.QuerySingleOrDefault<SavedPrompt>("SELECT * FROM backdropads.prompts WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId });

    public int CountPrompts(string workspaceId) =>
        Db.ExecuteScalar<int>("SELECT COUNT(*) FROM backdropads.prompts WHERE workspace_id = @workspaceId", new { workspaceId });

    public SavedPrompt AddPrompt(SavedPrompt p)
    {
        Db.Execute("""
            INSERT INTO backdropads.prompts (id, workspace_id, user_id, title, text, kind, target_model, group_id, position, use_count, last_used_at, created_at, updated_at)
            VALUES (@Id, @WorkspaceId, @UserId, @Title, @Text, @Kind, @TargetModel, @GroupId, @Position, @UseCount, @LastUsedAt, @CreatedAt, @UpdatedAt)
            """, p);
        return p;
    }

    public void UpdatePrompt(SavedPrompt p) => Db.Execute("""
        UPDATE backdropads.prompts SET title = @Title, text = @Text, kind = @Kind, updated_at = @UpdatedAt
        WHERE id = @Id AND workspace_id = @WorkspaceId
        """, p);

    /// <summary>Counts a use (inserted into Create), returning the prompt, or null when it doesn't exist.</summary>
    public SavedPrompt? MarkPromptUsed(string id, string workspaceId) =>
        Db.QuerySingleOrDefault<SavedPrompt>("""
            UPDATE backdropads.prompts SET use_count = use_count + 1, last_used_at = now()
            WHERE id = @id AND workspace_id = @workspaceId RETURNING *
            """, new { id, workspaceId });

    public bool RemovePrompt(string id, string workspaceId) =>
        Db.Execute("DELETE FROM backdropads.prompts WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId }) > 0;

    // Prompt groups: prompts written together from one message.

    public List<PromptGroup> ListPromptGroups(string workspaceId) =>
        [.. Db.Query<PromptGroup>("SELECT * FROM backdropads.prompt_groups WHERE workspace_id = @workspaceId ORDER BY created_at DESC", new { workspaceId })];

    public PromptGroup? GetPromptGroup(string id, string workspaceId) =>
        Db.QuerySingleOrDefault<PromptGroup>("SELECT * FROM backdropads.prompt_groups WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId });

    /// <summary>The group's prompts in order.</summary>
    public List<SavedPrompt> ListGroupPrompts(string groupId, string workspaceId) =>
        [.. Db.Query<SavedPrompt>("SELECT * FROM backdropads.prompts WHERE group_id = @groupId AND workspace_id = @workspaceId ORDER BY position, created_at", new { groupId, workspaceId })];

    /// <summary>Saves the group, then its prompts.</summary>
    public void AddPromptGroup(PromptGroup group, IReadOnlyList<SavedPrompt> prompts)
    {
        Db.Execute("""
            INSERT INTO backdropads.prompt_groups (id, workspace_id, user_id, name, kind, ratio, target_model, message, created_at)
            VALUES (@Id, @WorkspaceId, @UserId, @Name, @Kind, @Ratio, @TargetModel, @Message, @CreatedAt)
            """, group);
        foreach (var p in prompts) AddPrompt(p);
    }

    public bool RenamePromptGroup(string id, string workspaceId, string name) =>
        Db.Execute("UPDATE backdropads.prompt_groups SET name = @name WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId, name }) > 0;

    /// <summary>Deletes the group and its prompts (ON DELETE CASCADE).</summary>
    public bool RemovePromptGroup(string id, string workspaceId) =>
        Db.Execute("DELETE FROM backdropads.prompt_groups WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId }) > 0;

    // ---- Uploads (the user's file library) ------------------------------------

    public Upload AddUpload(Upload upload)
    {
        Db.Execute("""
            INSERT INTO backdropads.uploads (id, workspace_id, user_id, url, kind, purpose, file_name, content_type, size_bytes, created_at)
            VALUES (@Id, @WorkspaceId, @UserId, @Url, @Kind, @Purpose, @FileName, @ContentType, @SizeBytes, @CreatedAt)
            """, upload);
        return upload;
    }

    /// <summary>Newest first. `kind` (image, video, pdf, text) and `purpose` filter when given.</summary>
    public List<Upload> ListUploads(string workspaceId, string? kind = null, string? purpose = null, int limit = 200) =>
        [.. Db.Query<Upload>("""
            SELECT * FROM backdropads.uploads
            WHERE workspace_id = @workspaceId AND (@kind = '' OR kind = @kind) AND (@purpose = '' OR purpose = @purpose)
            ORDER BY created_at DESC LIMIT @limit
            """, new { workspaceId, kind = kind ?? "", purpose = purpose ?? "", limit })];

    public Upload? GetUpload(string id, string workspaceId) =>
        Db.QuerySingleOrDefault<Upload>("SELECT * FROM backdropads.uploads WHERE id = @id AND workspace_id = @workspaceId", new { id, workspaceId });

    /// <summary>Removes the library entry and returns it (the caller deletes the blob), or null when not found.</summary>
    public Upload? RemoveUpload(string id, string workspaceId) =>
        Db.QuerySingleOrDefault<Upload>("DELETE FROM backdropads.uploads WHERE id = @id AND workspace_id = @workspaceId RETURNING *", new { id, workspaceId });

    // ---- Templates (static catalog, not stored) --------------------------------

    public List<Template> ListTemplates() => TemplateLibrary.Catalog;

    // ---- Brand kits (primary + extras, per workspace) --------------------------

    private static string KitKey(string workspaceId, string kitId) => $"{workspaceId}:{kitId}";

    private Action<BrandKit> KitWriter(string workspaceId, string kitId) => kit => { TextLimits.Apply(kit); Db.Execute("""
        INSERT INTO backdropads.brand_kits (workspace_id, kit_id, created_at, data)
        VALUES (@workspaceId, @kitId, @now, CAST(@data AS jsonb))
        ON CONFLICT (workspace_id, kit_id) DO UPDATE SET data = excluded.data
        """, new { workspaceId, kitId, now = DateTimeOffset.UtcNow, data = JsonColumns.Serialize(kit) }); };

    private BrandKit? LoadKit(string workspaceId, string kitId) =>
        Cached<BrandKit>(KitKey(workspaceId, kitId))
        ?? LoadDocs<BrandKit>("SELECT data::text FROM backdropads.brand_kits WHERE workspace_id = @workspaceId AND kit_id = @kitId", new { workspaceId, kitId })
            .Select(k => Track(k, KitKey(workspaceId, kitId), KitWriter(workspaceId, kitId))).FirstOrDefault();

    public List<BrandKit> ListBrandKits(string workspaceId)
    {
        var primary = GetBrandKit(workspaceId);
        var extras = Db.Query<(string KitId, string Data)>("""
            SELECT kit_id, data::text FROM backdropads.brand_kits
            WHERE workspace_id = @workspaceId AND kit_id <> 'primary' ORDER BY created_at
            """, new { workspaceId })
            .Select(r => Track(JsonColumns.Deserialize<BrandKit>(r.Data), KitKey(workspaceId, r.KitId), KitWriter(workspaceId, r.KitId)));
        return [primary, .. extras];
    }

    public BrandKit AddBrandKit(string workspaceId, BrandKit kit)
    {
        var write = KitWriter(workspaceId, kit.Id);
        write(kit);
        return Retrack(kit, KitKey(workspaceId, kit.Id), write);
    }

    public bool RemoveBrandKit(string workspaceId, string id)
    {
        if (id == "primary") return false;
        Untrack<BrandKit>(KitKey(workspaceId, id));
        return Db.Execute("DELETE FROM backdropads.brand_kits WHERE workspace_id = @workspaceId AND kit_id = @id", new { workspaceId, id }) > 0;
    }

    /// <summary>"primary" → the main kit; bk_ id → that kit if owned; anything else → null.</summary>
    public BrandKit? FindBrandKit(string workspaceId, string id) =>
        id == "primary" ? GetBrandKit(workspaceId) : LoadKit(workspaceId, id);

    public BrandKit GetBrandKit(string workspaceId)
    {
        if (LoadKit(workspaceId, "primary") is { } existing) return existing;

        // A fresh workspace starts with a blank kit named after it — scan the store to fill it in.
        var kit = new BrandKit
        {
            BrandName = Db.QuerySingleOrDefault<string>("SELECT name FROM backdropads.workspaces WHERE id = @workspaceId", new { workspaceId }) ?? "My brand",
            Colors = ["#8B5CF6", "#0B0A14"],
            Fonts = ["", ""],
            Tone = "",
            DefaultCta = "Shop now",
        };
        return SetBrandKit(workspaceId, kit);
    }

    public BrandKit SetBrandKit(string workspaceId, BrandKit kit)
    {
        kit.Id = "primary";
        var write = KitWriter(workspaceId, "primary");
        write(kit);
        return Retrack(kit, KitKey(workspaceId, "primary"), write);
    }
}
