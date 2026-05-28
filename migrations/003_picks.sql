-- Story P2a: persistent audit log of every pick, used to compute fairness
-- stats per (team, scope). Scope is denormalised as (scope_type, scope_id) so
-- channel and list picks share the same table without a join to `lists`. List
-- scope_id stores the list *name* (matching the value parsed from
-- /meeny pick @<name>) so the stats and pick code paths agree without
-- needing to resolve the list's BIGSERIAL id.

CREATE TABLE IF NOT EXISTS picks (
  id              BIGSERIAL PRIMARY KEY,
  team_id         TEXT NOT NULL,
  scope_type      TEXT NOT NULL CHECK (scope_type IN ('channel', 'list')),
  scope_id        TEXT NOT NULL,
  picked_user_id  TEXT NOT NULL,
  picked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS picks_team_scope_idx
  ON picks (team_id, scope_type, scope_id, picked_at DESC);
CREATE INDEX IF NOT EXISTS picks_team_picked_at_idx
  ON picks (team_id, picked_at DESC);
