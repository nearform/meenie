/**
 * Stats service: append-only audit log of picks plus the fairness aggregation
 * read by `/meeny stats`.
 *
 * Error policy:
 *   - `recordPick` / `recordPicks` log-and-swallow on failure. Recording is
 *     fire-and-forget audit: a DB hiccup must never break the user-facing
 *     pick flow.
 *   - `getStats` propagates errors so the handler can surface a generic
 *     "something went wrong" message via the router's catch.
 */

import { query, queryOne, withTransaction } from "../db.ts";
import type { Scope, SlackUserId, TeamId } from "../types.ts";

const DEFAULT_WINDOW_DAYS = 30;

export interface StatsResult {
  scope: Scope;
  windowDays: number;
  totalPicks: number;
  perMember: Array<{
    userId: SlackUserId;
    count: number;
  }>;
  lastPickedAt: string | null;
}

interface SummaryRow {
  total: string;
  last_picked_at: Date | null;
}

interface PerMemberRow {
  picked_user_id: string;
  count: string;
}

export async function recordPick(
  teamId: TeamId,
  scope: Scope,
  pickedUserId: SlackUserId,
): Promise<void> {
  try {
    await query(
      `INSERT INTO picks (team_id, scope_type, scope_id, picked_user_id)
       VALUES ($1, $2, $3, $4)`,
      [teamId, scope.type, scope.id, pickedUserId],
    );
  } catch (err) {
    console.error("recordPick failed", { teamId, scope, pickedUserId, err });
  }
}

export async function recordPicks(
  teamId: TeamId,
  scope: Scope,
  pickedUserIds: readonly SlackUserId[],
): Promise<void> {
  if (pickedUserIds.length === 0) return;
  try {
    await withTransaction(async (client) => {
      for (const userId of pickedUserIds) {
        await client.query(
          `INSERT INTO picks (team_id, scope_type, scope_id, picked_user_id)
           VALUES ($1, $2, $3, $4)`,
          [teamId, scope.type, scope.id, userId],
        );
      }
    });
  } catch (err) {
    console.error("recordPicks failed", {
      teamId,
      scope,
      count: pickedUserIds.length,
      err,
    });
  }
}

export async function getStats(
  teamId: TeamId,
  scope: Scope,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<StatsResult> {
  const summary = await queryOne<SummaryRow>(
    `SELECT COUNT(*)::text AS total, MAX(picked_at) AS last_picked_at
     FROM picks
     WHERE team_id = $1
       AND scope_type = $2
       AND scope_id = $3
       AND picked_at >= NOW() - ($4::int * INTERVAL '1 day')`,
    [teamId, scope.type, scope.id, windowDays],
  );

  const totalPicks = summary ? Number.parseInt(summary.total, 10) : 0;
  const lastPickedAt = summary?.last_picked_at
    ? summary.last_picked_at.toISOString()
    : null;

  if (totalPicks === 0) {
    return {
      scope,
      windowDays,
      totalPicks: 0,
      perMember: [],
      lastPickedAt,
    };
  }

  const perMemberRows = await query<PerMemberRow>(
    `SELECT picked_user_id, COUNT(*)::text AS count
     FROM picks
     WHERE team_id = $1
       AND scope_type = $2
       AND scope_id = $3
       AND picked_at >= NOW() - ($4::int * INTERVAL '1 day')
     GROUP BY picked_user_id
     ORDER BY COUNT(*) DESC, picked_user_id ASC`,
    [teamId, scope.type, scope.id, windowDays],
  );

  return {
    scope,
    windowDays,
    totalPicks,
    perMember: perMemberRows.map((r) => ({
      userId: r.picked_user_id,
      count: Number.parseInt(r.count, 10),
    })),
    lastPickedAt,
  };
}
