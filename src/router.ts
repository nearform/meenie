import type { RespondFn, SlackCommandMiddlewareArgs } from "@slack/bolt";
import { boltApp } from "./slack.ts";

export type SubcommandContext = {
  teamId: string;
  userId: string;
  channelId: string;
  args: string[];
  rawText: string;
  command: SlackCommandMiddlewareArgs["command"];
  respond: RespondFn;
};

export type SubcommandHandler = (ctx: SubcommandContext) => Promise<void>;

const subcommands = new Map<string, SubcommandHandler>();

/**
 * Register a subcommand under `/meenie`. Idempotent on the name: duplicate
 * registrations throw to surface accidental collisions between parallel
 * agents during dev.
 *
 * Frozen contract: parallel agents must add subcommands via this function so
 * the router stays the single source of truth.
 */
export function registerSubcommand(name: string, handler: SubcommandHandler): void {
  const key = name.toLowerCase();
  if (subcommands.has(key)) {
    throw new Error(`Subcommand "${key}" is already registered`);
  }
  subcommands.set(key, handler);
}

export function listSubcommands(): readonly string[] {
  return [...subcommands.keys()].sort();
}

boltApp.command("/meenie", async ({ command, ack, respond }) => {
  await ack();
  const rawText = (command.text ?? "").trim();
  const [name = "help", ...args] = rawText.split(/\s+/).filter(Boolean);
  const handler = subcommands.get(name.toLowerCase());
  if (!handler) {
    await respond({
      response_type: "ephemeral",
      text: `Unknown subcommand: \`${name}\`. Try \`/meenie help\`.`,
    });
    return;
  }
  try {
    await handler({
      teamId: command.team_id,
      userId: command.user_id,
      channelId: command.channel_id,
      args,
      rawText,
      command,
      respond,
    });
  } catch (err) {
    console.error(`/meenie ${name} failed`, err);
    await respond({
      response_type: "ephemeral",
      text: `Sorry, something went wrong running \`/meenie ${name}\`.`,
    });
  }
});
