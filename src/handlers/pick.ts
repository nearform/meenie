import { boltApp } from "../slack.ts";
import { registerSubcommand } from "../router.ts";
import { pickFromChannel, pickFromList } from "../picker/index.ts";
import { decodeScope, pickResultBlocks } from "../blocks/pickResult.ts";
import { ListNotFoundError } from "../lists/index.ts";
import type { Scope } from "../types.ts";

const CHANNEL_ID_RE = /^[CGD][A-Z0-9]+$/i;
const LIST_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

/**
 * Decide what `/meeny pick <arg>` should pick from:
 *  - `<#C123|name>` or bare `C123/G123/D123`  -> channel
 *  - `@listname` or bare `listname` matching the list-name regex -> list
 *  - empty -> fall back to the invocation channel
 *
 * Channel IDs (`[CGD][A-Z0-9]+`) and list names (`[a-z0-9][a-z0-9_-]{0,31}`)
 * don't collide because the regexes have disjoint first characters once we
 * uppercase-test the channel form.
 */
export function parsePickTarget(arg: string | undefined, fallbackChannel: string): Scope {
  if (!arg) return { type: "channel", id: fallbackChannel };

  const mention = arg.match(/^<#([A-Z0-9]+)(?:\|[^>]*)?>$/);
  if (mention?.[1]) return { type: "channel", id: mention[1] };

  if (CHANNEL_ID_RE.test(arg)) return { type: "channel", id: arg.toUpperCase() };

  const stripped = arg.startsWith("@") || arg.startsWith(":") ? arg.slice(1) : arg;
  if (LIST_NAME_RE.test(stripped)) {
    return { type: "list", id: stripped.toLowerCase() };
  }

  return { type: "channel", id: fallbackChannel };
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function pickForScope(
  teamId: string,
  scope: Scope,
): Promise<{ picked: string[]; total: number }> {
  if (scope.type === "channel") {
    return pickFromChannel(teamId, scope.id);
  }
  return pickFromList(teamId, scope.id);
}

function emptyMessage(scope: Scope): string {
  return scope.type === "channel"
    ? `No eligible members in <#${scope.id}>. Bots and deactivated users are skipped — invite some humans and try again.`
    : `The list \`${scope.id}\` is empty. Add members with \`/meeny list add ${scope.id} @user\`.`;
}

async function respondToError(
  err: unknown,
  scope: Scope,
  respond: (msg: { response_type?: "ephemeral" | "in_channel"; text: string; replace_original?: boolean }) => Promise<unknown>,
): Promise<boolean> {
  if (err instanceof ListNotFoundError) {
    await respond({
      response_type: "ephemeral",
      text: `No list named \`${scope.type === "list" ? scope.id : ""}\`. Create one with \`/meeny list create <name>\`.`,
    });
    return true;
  }
  const message = describeError(err);
  if (scope.type === "channel" && message.includes("channel_not_found")) {
    await respond({
      response_type: "ephemeral",
      text: `I can't see <#${scope.id}>. Double-check the channel, or invite me to it with \`/invite @meeny\`.`,
    });
    return true;
  }
  if (scope.type === "channel" && message.includes("not_in_channel")) {
    await respond({
      response_type: "ephemeral",
      text: `I'm not a member of <#${scope.id}>. Run \`/invite @meeny\` there and try again.`,
    });
    return true;
  }
  return false;
}

registerSubcommand("pick", async (ctx) => {
  const scope = parsePickTarget(ctx.args[0], ctx.channelId);
  try {
    const result = await pickForScope(ctx.teamId, scope);
    if (result.picked.length === 0) {
      await ctx.respond({
        response_type: "ephemeral",
        text: emptyMessage(scope),
      });
      return;
    }
    await ctx.respond({
      response_type: "in_channel",
      ...pickResultBlocks({
        scope,
        pickedUserIds: result.picked,
        total: result.total,
      }),
    });
  } catch (err) {
    const handled = await respondToError(err, scope, ctx.respond);
    if (!handled) throw err;
  }
});

boltApp.action("pick_again", async ({ ack, body, respond }) => {
  await ack();
  if (body.type !== "block_actions") return;

  const action = body.actions[0];
  const buttonValue = action && action.type === "button" ? action.value : undefined;
  const scope =
    decodeScope(buttonValue) ??
    (body.channel?.id ? ({ type: "channel", id: body.channel.id } satisfies Scope) : null);

  if (!scope) {
    await respond({
      response_type: "ephemeral",
      replace_original: false,
      text: "I lost track of what to pick from. Try `/meeny pick #channel` or `/meeny pick @listname` again.",
    });
    return;
  }

  const teamId = body.team?.id ?? body.user.team_id;
  if (!teamId) {
    await respond({
      response_type: "ephemeral",
      replace_original: false,
      text: "Couldn't resolve your workspace. Try `/meeny pick` again.",
    });
    return;
  }

  try {
    const result = await pickForScope(teamId, scope);
    if (result.picked.length === 0) {
      await respond({
        response_type: "ephemeral",
        replace_original: false,
        text: emptyMessage(scope),
      });
      return;
    }
    await respond({
      replace_original: true,
      ...pickResultBlocks({
        scope,
        pickedUserIds: result.picked,
        total: result.total,
      }),
    });
  } catch (err) {
    console.error("pick_again failed", err);
    const handled = await respondToError(err, scope, respond);
    if (!handled) {
      await respond({
        response_type: "ephemeral",
        replace_original: false,
        text: `Sorry, I couldn't pick again.`,
      });
    }
  }
});
