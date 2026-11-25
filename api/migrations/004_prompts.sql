-- Saved prompts: the user's own library of prompts to reuse in Create (often written with "Improve with AI").
CREATE TABLE IF NOT EXISTS backdropads.prompts (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES backdropads.workspaces(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES backdropads.users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    text         TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'image',   -- image | video
    use_count    INT NOT NULL DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_prompts_workspace ON backdropads.prompts (workspace_id, updated_at DESC);
