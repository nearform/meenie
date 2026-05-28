-- Story F1: foundation. Tracks installed Slack workspaces.
-- Other tables (lists, list_members, picks) are owned by P1b / P2a in their
-- own migration files (002_lists.sql, 003_picks.sql).

CREATE TABLE IF NOT EXISTS teams (
  team_id      TEXT PRIMARY KEY,
  team_name    TEXT,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS teams_installed_at_idx ON teams (installed_at);
