-- Story P1b: custom lists per workspace and their members.
-- Names are validated upstream as /^[a-z0-9][a-z0-9_-]{0,31}$/i and normalised
-- to lowercase by the service layer, so the UNIQUE constraint below behaves as
-- a case-insensitive identifier without needing CITEXT.

CREATE TABLE IF NOT EXISTS lists (
  id          BIGSERIAL PRIMARY KEY,
  team_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, name)
);

CREATE TABLE IF NOT EXISTS list_members (
  list_id        BIGINT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  slack_user_id  TEXT NOT NULL,
  added_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (list_id, slack_user_id)
);

CREATE INDEX IF NOT EXISTS list_members_list_id_idx ON list_members (list_id);
