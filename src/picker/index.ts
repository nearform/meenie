import type { RandomFn, SlackUserId } from "../types.ts";
import { resolveListMembers } from "../lists/index.ts";
import { getClientForTeam } from "../slack.ts";
import { getPickCounts, recordPicks } from "../stats/index.ts";
import { DEFAULT_FAIRNESS_WINDOW_DAYS, recencyWeights } from "./fairness.ts";

/**
 * Uniformly pick `n` distinct members from `members` using the injected `rng`.
 *
 * Pure and deterministic for a given `rng`: the test suite seeds this with
 * mulberry32 to make statistical assertions reproducible. If `n` exceeds the
 * pool, every member is returned in a shuffled order. Throws when the pool is
 * empty so callers surface a user-friendly message instead of silently
 * returning nothing.
 *
 * This is the uniform-random primitive. For recency-aware fairness use
 * `pickWeighted` instead — `pickFromChannel` and `pickFromList` already do.
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
 * Weighted random sample without replacement.
 *
 *   - `members` and `weights` are positional (same length, same order).
 *   - Each weight must be a non-negative finite number. NaN/Infinity/negative
 *     weights are coerced to 0 — defensive against a future weight policy
 *     bug; the test suite asserts the coercion explicitly.
 *   - If every remaining weight is 0 (e.g. all members were heavily picked
 *     and the weight policy returned zeros), the function transparently
 *     falls back to a uniform draw over the remaining pool rather than
 *     looping forever or returning fewer items than asked.
 *   - `n` is clamped to `[0, members.length]` to match `pick`'s shape
 *     guarantees.
 *
 * Implementation: roulette-wheel selection inside a Fisher-Yates-style
 * partition. Each iteration takes O(pool.length) which is fine for the small
 * pools we care about (typical Slack channels are tens of members, not
 * millions). If pools ever grow large enough to matter, swap in A-Res
 * (Efraimidis-Spirakis) without changing the call sites.
 */
export function pickWeighted<T>(
  rng: RandomFn,
  members: readonly T[],
  weights: readonly number[],
  n: number = 1,
): T[] {
  if (members.length === 0) {
    throw new Error("no members to pick from");
  }
  if (members.length !== weights.length) {
    throw new Error(
      `pickWeighted: members.length (${members.length}) !== weights.length (${weights.length})`,
    );
  }
  const take = Math.min(Math.max(n, 0), members.length);
  if (take === 0) return [];

  const pool: T[] = [...members];
  const w: number[] = weights.map((x) =>
    Number.isFinite(x) && x > 0 ? x : 0,
  );

  const picked: T[] = [];
  for (let drawn = 0; drawn < take; drawn++) {
    const remaining = pool.length - drawn;
    let total = 0;
    for (let i = drawn; i < pool.length; i++) total += w[i] as number;

    let j: number;
    if (total <= 0) {
      // All remaining weights are zero — degenerate, fall back to uniform.
      j = drawn + Math.floor(rng() * remaining);
    } else {
      const target = rng() * total;
      let cumulative = 0;
      j = pool.length - 1;
      for (let i = drawn; i < pool.length; i++) {
        cumulative += w[i] as number;
        if (target < cumulative) {
          j = i;
          break;
        }
      }
    }

    const a = pool[drawn] as T;
    const b = pool[j] as T;
    pool[drawn] = b;
    pool[j] = a;
    const wa = w[drawn] as number;
    const wb = w[j] as number;
    w[drawn] = wb;
    w[j] = wa;

    picked.push(pool[drawn] as T);
  }
  return picked;
}

/**
 * Build recency-aware weights for `memberIds` by reading the picks audit for
 * `(teamId, scope)` over `windowDays`. Falls back to uniform weights (all 1)
 * if the read fails — picking must keep working even when Postgres is
 * sneezing; the only loss is the fairness bias for one round, which is then
 * audited and corrected by the next pick.
 */
async function fairnessWeightsFor(
  teamId: string,
  scope: { type: "channel" | "list"; id: string },
  memberIds: readonly SlackUserId[],
  windowDays: number = DEFAULT_FAIRNESS_WINDOW_DAYS,
): Promise<number[]> {
  try {
    const counts = await getPickCounts(teamId, scope, windowDays);
    return recencyWeights(memberIds, counts);
  } catch (err) {
    console.error("fairnessWeightsFor: falling back to uniform", {
      teamId,
      scope,
      err,
    });
    return memberIds.map(() => 1);
  }
}

/**
 * Fetch a channel's members via the Slack Web API, drop bots and deactivated
 * users (the typical eeny.io picker rules), then random-pick `n` of the
 * remainder. `Math.random` is injected at this boundary so the inner
 * `pickWeighted` stays pure.
 *
 * Picks are recency-weighted: members picked recently in this channel get
 * proportionally smaller weights. See `src/picker/fairness.ts` for the
 * policy.
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

  const scope = { type: "channel" as const, id: channelId };
  const weights = await fairnessWeightsFor(teamId, scope, eligible);
  const picked = pickWeighted(Math.random, eligible, weights, n);
  // Awaited rather than fire-and-forget: recordPicks already swallows-and-logs
  // its own errors, so awaiting adds at most one cheap insert's latency while
  // guaranteeing the audit row lands before we hand control back to the user
  // — and before the *next* fairness read.
  await recordPicks(teamId, scope, picked);
  return { picked, total: eligible.length };
}

/**
 * Pick from a custom list owned by the team. Thin wrapper over
 * `resolveListMembers` (the contract P1b exposes) plus recency-weighted
 * sampling. Propagates `ListNotFoundError` so the handler can surface a
 * tailored hint.
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
  // Scope id is the list *name* — same string parsePickTarget feeds back into
  // /meenie stats — so audit rows for picks and stats lookups agree without
  // resolving the list's BIGSERIAL id.
  const scope = { type: "list" as const, id: listName };
  const weights = await fairnessWeightsFor(teamId, scope, memberIds);
  const picked = pickWeighted(Math.random, memberIds, weights, n);
  await recordPicks(teamId, scope, picked);
  return { picked, total: memberIds.length };
}
