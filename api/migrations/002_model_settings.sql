-- Model versions chosen by "Update models" (Settings → System). Each row overrides one setting from
-- appsettings.json / the environment, e.g. AI:OpenAI:FlareModel → gpt-image-2.6-flare, plus the display
-- name that goes with it (AI:ModelNames:{model}). Empty table = the built-in defaults.
CREATE TABLE IF NOT EXISTS backdropads.model_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
