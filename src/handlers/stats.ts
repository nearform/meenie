/**
 * `/meeny stats <#channel | @listname | bare list-name>` — fairness report.
 *
 * Reuses `parsePickTarget` from the pick handler so /meeny stats accepts the
 * exact same argument shapes as /meeny pick (chosen over lifting the parser
 * into its own helper module because the function is already exported and
 * has no other callers — see story write-up).
 *
 * All responses are ephemeral: stats are personal-noise rather than
 * channel-noise, and the design doc explicitly calls this out.
 */

import { registerSubcommand } from "../router.ts";
import { parsePickTarget } from "./pick.ts";
import { getStats } from "../stats/index.ts";
import { statsResultBlocks } from "../blocks/statsResult.ts";
import type { Scope } from "../types.ts";

function describeScope(scope: Scope): string {
  return scope.type === "channel" ? `<#${scope.id}>` : `\`${scope.id}\``;
}

registerSubcommand("stats", async (ctx) => {
  const scope = parsePickTarget(ctx.args[0], ctx.channelId);
  const result = await getStats(ctx.teamId, scope);

  if (result.totalPicks === 0) {
    await ctx.respond({
      response_type: "ephemeral",
      text: `No picks recorded yet for ${describeScope(scope)}. Run \`/meeny pick\` first.`,
    });
    return;
  }

  await ctx.respond({
    response_type: "ephemeral",
    ...statsResultBlocks(result),
  });
});
