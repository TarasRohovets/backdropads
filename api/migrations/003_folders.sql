-- Folders: the user's own way to organise saved ads (e.g. "Instagram ads", "TikTok ads", "Website ads").
-- Folders nest (parent_id). An ad belongs to at most one folder (ads.data->>'folderId'); deleting a folder
-- deletes its subfolders too, but every ad stays in My Ads.
CREATE TABLE IF NOT EXISTS backdropads.folders (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES backdropads.workspaces(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES backdropads.users(id) ON DELETE CASCADE,
    parent_id    TEXT REFERENCES backdropads.folders(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    color        TEXT NOT NULL DEFAULT 'violet',
    position     INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_folders_workspace ON backdropads.folders (workspace_id, position, created_at);

-- The starter folders are created once per workspace; after that, deleting them all leaves none.
ALTER TABLE backdropads.workspaces ADD COLUMN IF NOT EXISTS folders_seeded BOOLEAN NOT NULL DEFAULT FALSE;
