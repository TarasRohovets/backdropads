-- BackdropAds schema (PostgreSQL). Idempotent: every file in /migrations runs at API startup, in name order.
-- Workspaces are plain columns; content (generations, ads, analyses, flows, products, brand kits) keeps its key
-- columns plus the full object as jsonb in `data`.

CREATE SCHEMA IF NOT EXISTS backdropads;

-- ── Owner and workspaces ────────────────────────────────────────────────────────
-- There is no sign-in: an instance has one user row (created on first start) that owns the workspaces.
CREATE TABLE IF NOT EXISTS backdropads.users (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS backdropads.workspaces (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES backdropads.users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_workspaces_owner ON backdropads.workspaces (owner_id, created_at);

-- ── Content (per workspace; deleting a workspace deletes its content) ───────────
CREATE TABLE IF NOT EXISTS backdropads.generations (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES backdropads.workspaces(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL REFERENCES backdropads.users(id) ON DELETE CASCADE,
    status        TEXT NOT NULL,                 -- Processing | Completed | Failed
    creative_type TEXT NOT NULL,                 -- Image | Video | Carousel
    claimed_at    TIMESTAMPTZ,                   -- set by the one request that runs the providers
    created_at    TIMESTAMPTZ NOT NULL,
    data          JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_generations_workspace ON backdropads.generations (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_generations_user_status ON backdropads.generations (user_id, status);

CREATE TABLE IF NOT EXISTS backdropads.ads (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES backdropads.workspaces(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES backdropads.users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL,
    data         JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ads_workspace ON backdropads.ads (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS backdropads.analyses (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES backdropads.workspaces(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES backdropads.users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL,
    data         JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_analyses_workspace ON backdropads.analyses (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS backdropads.flows (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES backdropads.workspaces(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES backdropads.users(id) ON DELETE CASCADE,
    updated_at   TIMESTAMPTZ NOT NULL,
    data         JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_flows_workspace ON backdropads.flows (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS backdropads.products (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES backdropads.workspaces(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES backdropads.users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL,
    data         JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_products_workspace ON backdropads.products (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS backdropads.brand_kits (
    workspace_id TEXT NOT NULL REFERENCES backdropads.workspaces(id) ON DELETE CASCADE,
    kit_id       TEXT NOT NULL,                  -- "primary" or bk_…
    created_at   TIMESTAMPTZ NOT NULL,
    data         JSONB NOT NULL,
    PRIMARY KEY (workspace_id, kit_id)
);

-- Files users upload (product photos, attachments, ads to analyze, logos), so they can reuse them later.
-- The file itself is in media storage (uploads/…); this row is the library entry.
CREATE TABLE IF NOT EXISTS backdropads.uploads (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES backdropads.workspaces(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES backdropads.users(id) ON DELETE CASCADE,
    url          TEXT NOT NULL,
    kind         TEXT NOT NULL,                  -- image | video | pdf | text
    purpose      TEXT NOT NULL,                  -- source | attachment | ad | logo
    file_name    TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes   BIGINT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_uploads_workspace ON backdropads.uploads (workspace_id, created_at DESC);

-- Model availability reports (Settings → Models). Report only: nothing switches automatically.
CREATE TABLE IF NOT EXISTS backdropads.model_checks (
    id          BIGSERIAL PRIMARY KEY,
    checked_at  TIMESTAMPTZ NOT NULL,
    trigger     TEXT NOT NULL,                   -- weekly | manual
    unavailable INT NOT NULL,                    -- models that are gone / deprecated / rejected
    results     JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_model_checks_checked ON backdropads.model_checks (checked_at DESC);
