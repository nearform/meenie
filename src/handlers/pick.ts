import { boltApp } from "../slack.ts";
import { registerSubcommand } from "../router.ts";
import { pickFromChannel } from "../picker/index.ts";
import { pickResultBlocks } from "../blocks/pickResult.ts";

/**
 * Extract a channel ID from the first slash-command argument. Accepts the
 * `<#C123|name>` mention that Slack auto-formats when a user types `#chan`,
 * a bare channel ID (`C123`/`G123`/`D123`), and falls back to `fallback`
 * (the invocation channel) when no arg is given.
 */
export function parseChannelArg(arg: string | undefined, fallback: string): string {
  if (!arg) return fallback;
  const mention = arg.match(/^<#([A-Z0-9]+)(?:\|[^>]*)?>$/);
  if (mention && mention[1]) return mention[1];
  if (/^[CGD][A-Z0-9]+$/i.test(arg)) return arg.toUpperCase();
  return fallback;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

registerSubcommand("pick", async (ctx) => {
  const channelId = parseChannelArg(ctx.args[0], ctx.channelId);
  try {
    const result = await pickFromChannel(ctx.teamId, channelId);
    if (result.picked.length === 0) {
      await ctx.respond({
        response_type: "ephemeral",
        text: `No eligible members in <#${channelId}>. Bots and deactivated users are skipped — invite some humans and try again.`,
      });
      return;
    }
    await ctx.respond({
      response_type: "in_channel",
      ...pickResultBlocks({
        channelId,
        pickedUserIds: result.picked,
        total: result.total,
      }),
    });
  } catch (err) {
    const message = describeError(err);
    if (message.includes("channel_not_found")) {
      await ctx.respond({
        response_type: "ephemeral",
        text: `I can't see <#${channelId}>. Double-check the channel, or invite me to it with \`/invite @meeny\`.`,
      });
      return;
    }
    if (message.includes("not_in_channel")) {
      await ctx.respond({
        response_type: "ephemeral",
        text: `I'm not a member of <#${channelId}>. Run \`/invite @meeny\` there and try again.`,
      });
      return;
    }
    throw err;
  }
});

boltApp.action("pick_again", async ({ ack, body, respond }) => {
  await ack();
  if (body.type !== "block_actions") return;

  const action = body.actions[0];
  const channelId =
    (action && action.type === "button" ? action.value : undefined) ?? body.channel?.id;
  if (!channelId) {
    await respond({
      response_type: "ephemeral",
      replace_original: false,
      text: "I lost track of which channel to pick from. Try `/meeny pick #channel` again.",
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
    const result = await pickFromChannel(teamId, channelId);
    if (result.picked.length === 0) {
      await respond({
        response_type: "ephemeral",
        replace_original: false,
        text: `No eligible members in <#${channelId}>.`,
      });
      return;
    }
    await respond({
      replace_original: true,
      ...pickResultBlocks({
        channelId,
        pickedUserIds: result.picked,
        total: result.total,
      }),
    });
  } catch (err) {
    console.error("pick_again failed", err);
    const message = describeError(err);
    const hint =
      message.includes("channel_not_found") || message.includes("not_in_channel")
        ? ` I might have been removed from <#${channelId}>.`
        : "";
    await respond({
      response_type: "ephemeral",
      replace_original: false,
      text: `Sorry, I couldn't pick again.${hint}`,
    });
  }
});
