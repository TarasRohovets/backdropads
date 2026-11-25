-- Prompt groups: a set of prompts written together by "Write with AI" on the Prompts page ("3 photos: x, y, z").
-- A group goes to Flows as one image per prompt; any single prompt can be used in Create for one image.
-- Deleting a group deletes its prompts.
CREATE TABLE IF NOT EXISTS backdropads.prompt_groups (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES backdropads.workspaces(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES backdropads.users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'image',   -- image | video
    ratio        TEXT NOT NULL DEFAULT '4:5',
    target_model TEXT,                            -- ModelCatalog id the prompts were written for ("nano-banana-pro")
    message      TEXT,                            -- what the user asked for
    created_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_prompt_groups_workspace ON backdropads.prompt_groups (workspace_id, created_at DESC);

ALTER TABLE backdropads.prompts ADD COLUMN IF NOT EXISTS group_id TEXT REFERENCES backdropads.prompt_groups(id) ON DELETE CASCADE;
ALTER TABLE backdropads.prompts ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;
ALTER TABLE backdropads.prompts ADD COLUMN IF NOT EXISTS target_model TEXT;
