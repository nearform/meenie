import type { RandomFn } from "../types.ts";
import { resolveListMembers } from "../lists/index.ts";
import { getClientForTeam } from "../slack.ts";
import { recordPicks } from "../stats/index.ts";

/**
 * Uniformly pick `n` distinct members from `members` using the injected `rng`.
 *
 * Pure and deterministic for a given `rng`: P3b relies on this to seed the
 * picker in tests. If `n` exceeds the pool, every member is returned in a
 * shuffled order. Throws when the pool is empty so callers surface a
 * user-friendly message instead of silently returning nothing.
 */
export function pick<T>(rng: RandomFn, members: readonly T[], n: number = 1): T[] {
  if (members.length === 0) {
    throw new Error("no members to pick from");
  }
  const take = Math.min(Math.max(n, 0), members.length);
  if (take === 0) return [];

  const pool: T[] = [...members];
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const a = pool[i] as T;
    const b = pool[j] as T;
    pool[i] = b;
    pool[j] = a;
  }
  return pool.slice(0, take);
}

/**
 * Fetch a channel's members via the Slack Web API, drop bots and deactivated
 * users (the typical eeny.io picker rules), then random-pick `n` of the
 * remainder. `Math.random` is injected at this boundary so the inner `pick`
 * stays pure.
 */
export async function pickFromChannel(
  teamId: string,
  channelId: string,
  n: number = 1,
): Promise<{ picked: string[]; total: number }> {
  const client = await getClientForTeam(teamId);
  const membersResp = await client.conversations.members({ channel: channelId });
  const memberIds: string[] = membersResp.members ?? [];

  if (memberIds.length === 0) {
    return { picked: [], total: 0 };
  }

  const infos = await Promise.all(
    memberIds.map((id) => client.users.info({ user: id })),
  );

  const eligible: string[] = [];
  for (let i = 0; i < memberIds.length; i++) {
    const id = memberIds[i];
    const user = infos[i]?.user;
    if (!id || !user) continue;
    if (user.is_bot === true) continue;
    if (user.deleted === true) continue;
    // Slackbot has is_bot=false in some workspaces; filter it explicitly.
    if (user.id === "USLACKBOT") continue;
    eligible.push(id);
  }

  if (eligible.length === 0) {
    return { picked: [], total: 0 };
  }

  const picked = pick(Math.random, eligible, n);
  // Awaited rather than fire-and-forget: recordPicks already swallows-and-logs
  // its own errors, so awaiting adds at most one cheap insert's latency while
  // guaranteeing the audit row lands before we hand control back to the user.
  await recordPicks(teamId, { type: "channel", id: channelId }, picked);
  return { picked, total: eligible.length };
}

/**
 * Pick from a custom list owned by the team. Thin wrapper over
 * `resolveListMembers` (the contract P1b exposes) plus the pure `pick`.
 * Propagates `ListNotFoundError` so the handler can surface a tailored hint.
 */
export async function pickFromList(
  teamId: string,
  listName: string,
  n: number = 1,
): Promise<{ picked: string[]; total: number }> {
  const memberIds = await resolveListMembers(teamId, listName);
  if (memberIds.length === 0) {
    return { picked: [], total: 0 };
  }
  const picked = pick(Math.random, memberIds, n);
  // Scope id is the list *name* — same string parsePickTarget feeds back into
  // /meenie stats — so audit rows for picks and stats lookups agree without
  // resolving the list's BIGSERIAL id.
  await recordPicks(teamId, { type: "list", id: listName }, picked);
  return { picked, total: memberIds.length };
}
