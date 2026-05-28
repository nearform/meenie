import type { SlackUserId } from "../types.ts";

/**
 * Default fairness window. Matches `/meenie stats`'s default so the audit
 * surface that users see is the same one the picker reasons about: "you have
 * been picked twice in the last 30 days, so you are picked less likely now".
 */
export const DEFAULT_FAIRNESS_WINDOW_DAYS = 30;

/**
 * Map a list of eligible member IDs to fairness weights.
 *
 * Policy (intentionally simple — readable beats clever for an audit-driven
 * feature):
 *
 *     weight = 1 / (1 + picks_in_window)
 *
 *   never picked → 1
 *   picked once  → 1/2
 *   picked twice → 1/3
 *   picked 5×    → 1/6
 *
 * Two consequences worth understanding:
 *
 *  1. Weights never reach zero. A member who has been picked 10 times in the
 *     window can still be picked again — the bias is strong but not absolute.
 *     This is deliberate: hard zeros invite "wait, why was I excluded?"
 *     conversations, and a 1/11 weight against an unpicked member's weight 1
 *     is already ~91% in favour of the fresher choice. For N=7 with one
 *     heavy hitter that's effectively never re-picked while peers are fresh,
 *     which is the property users actually want.
 *
 *  2. The window matters more than the curve. A long window (90 days)
 *     remembers grudges; a short window (7 days) only smoothens the current
 *     week. The default is 30 days to match `/meenie stats` so the audit
 *     view and the fairness policy reason about the same slice of history.
 *
 * The output array is positionally aligned with `memberIds` so callers can
 * pass both to `pickWeighted(rng, members, weights, n)` without juggling
 * indices.
 */
export function recencyWeights(
  memberIds: readonly SlackUserId[],
  counts: ReadonlyMap<SlackUserId, number>,
): number[] {
  const weights: number[] = new Array(memberIds.length);
  for (let i = 0; i < memberIds.length; i++) {
    const id = memberIds[i] as SlackUserId;
    const c = counts.get(id) ?? 0;
    weights[i] = 1 / (1 + c);
  }
  return weights;
}
