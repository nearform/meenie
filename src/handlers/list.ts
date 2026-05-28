/**
 * `/meenie list <action> [args]` — workspace-scoped custom lists.
 *
 * Actions:
 *   (none) | index      → enumerate lists
 *   create <name>       → create a new list
 *   delete|del <name>   → delete an existing list
 *   add    <name> @user [@user ...]
 *   remove|rm <name> @user [@user ...]
 *   show   <name>
 *
 * All responses are ephemeral. Names must match
 * /^[a-z0-9][a-z0-9_-]{0,31}$/i. User mentions are parsed from `<@U123>` or
 * `<@U123|name>` tokens; anything else is reported as ignored.
 */

import type { SlackUserId } from "../types.ts";
import {
  ListAlreadyExistsError,
  ListNotFoundError,
  addMember,
  createList,
  deleteList,
  listAllLists,
  removeMember,
  showList,
} from "../lists/index.ts";
import { listIndexBlocks, listShowBlocks } from "../blocks/listResult.ts";
import { registerSubcommand, type SubcommandContext } from "../router.ts";

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const MENTION_PATTERN = /^<@([UW][A-Z0-9]+)(?:\|[^>]*)?>$/;
const BARE_USER_ID_PATTERN = /^[UW][A-Z0-9]{2,}$/;

function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

interface MentionParse {
  userIds: SlackUserId[];
  ignored: string[];
}

export function parseUserMentions(args: readonly string[]): MentionParse {
  const userIds: SlackUserId[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  for (const token of args) {
    const mention = MENTION_PATTERN.exec(token);
    let id: string | null = null;
    if (mention?.[1]) {
      id = mention[1];
    } else if (BARE_USER_ID_PATTERN.test(token)) {
      id = token;
    }
    if (id === null) {
      ignored.push(token);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    userIds.push(id);
  }
  return { userIds, ignored };
}

async function respondEphemeral(
  ctx: SubcommandContext,
  text: string,
): Promise<void> {
  await ctx.respond({ response_type: "ephemeral", text });
}

async function actionIndex(ctx: SubcommandContext): Promise<void> {
  const lists = await listAllLists(ctx.teamId);
  await ctx.respond({
    response_type: "ephemeral",
    text:
      lists.length === 0
        ? "No lists yet. Create one with `/meenie list create <name>`."
        : `Lists (${lists.length}): ${lists.map((l) => `\`${l.name}\``).join(", ")}`,
    blocks: listIndexBlocks(lists),
  });
}

async function actionCreate(
  ctx: SubcommandContext,
  rest: readonly string[],
): Promise<void> {
  const name = rest[0];
  if (!name) {
    await respondEphemeral(ctx, "Usage: `/meenie list create <name>`");
    return;
  }
  if (rest.length > 1) {
    await respondEphemeral(
      ctx,
      "List names cannot contain spaces. Usage: `/meenie list create <name>`",
    );
    return;
  }
  if (!isValidName(name)) {
    await respondEphemeral(
      ctx,
      `Invalid list name \`${name}\`. Names must be 1–32 characters of letters, digits, \`-\` or \`_\`, starting with a letter or digit.`,
    );
    return;
  }
  try {
    const list = await createList(ctx.teamId, name);
    await respondEphemeral(
      ctx,
      `Created list \`${list.name}\`. Add members with \`/meenie list add ${list.name} @user\`.`,
    );
  } catch (err) {
    if (err instanceof ListAlreadyExistsError) {
      await respondEphemeral(ctx, `List \`${err.listName}\` already exists.`);
      return;
    }
    throw err;
  }
}

async function actionDelete(
  ctx: SubcommandContext,
  rest: readonly string[],
): Promise<void> {
  const name = rest[0];
  if (!name) {
    await respondEphemeral(ctx, "Usage: `/meenie list delete <name>`");
    return;
  }
  if (!isValidName(name)) {
    await respondEphemeral(ctx, `Invalid list name \`${name}\`.`);
    return;
  }
  const deleted = await deleteList(ctx.teamId, name);
  await respondEphemeral(
    ctx,
    deleted
      ? `Deleted list \`${name.toLowerCase()}\`.`
      : `No list named \`${name.toLowerCase()}\`.`,
  );
}

async function actionAdd(
  ctx: SubcommandContext,
  rest: readonly string[],
): Promise<void> {
  const name = rest[0];
  const mentionTokens = rest.slice(1);
  if (!name || mentionTokens.length === 0) {
    await respondEphemeral(
      ctx,
      "Usage: `/meenie list add <name> @user [@user ...]`",
    );
    return;
  }
  if (!isValidName(name)) {
    await respondEphemeral(ctx, `Invalid list name \`${name}\`.`);
    return;
  }
  const { userIds, ignored } = parseUserMentions(mentionTokens);
  if (userIds.length === 0) {
    await respondEphemeral(
      ctx,
      `No valid user mentions in: ${ignored.map((t) => `\`${t}\``).join(", ")}. Use \`@username\` (Slack will expand to a mention).`,
    );
    return;
  }
  try {
    for (const id of userIds) {
      await addMember(ctx.teamId, name, id);
    }
  } catch (err) {
    if (err instanceof ListNotFoundError) {
      await respondEphemeral(
        ctx,
        `No list named \`${err.listName}\`. Create it with \`/meenie list create ${err.listName}\`.`,
      );
      return;
    }
    throw err;
  }
  const parts: string[] = [
    `Added ${userIds.length} member${userIds.length === 1 ? "" : "s"} to \`${name.toLowerCase()}\`: ${userIds
      .map((id) => `<@${id}>`)
      .join(", ")}.`,
  ];
  if (ignored.length > 0) {
    parts.push(
      `Ignored ${ignored.length} unrecognised token${ignored.length === 1 ? "" : "s"}: ${ignored
        .map((t) => `\`${t}\``)
        .join(", ")}.`,
    );
  }
  await respondEphemeral(ctx, parts.join(" "));
}

async function actionRemove(
  ctx: SubcommandContext,
  rest: readonly string[],
): Promise<void> {
  const name = rest[0];
  const mentionTokens = rest.slice(1);
  if (!name || mentionTokens.length === 0) {
    await respondEphemeral(
      ctx,
      "Usage: `/meenie list remove <name> @user [@user ...]`",
    );
    return;
  }
  if (!isValidName(name)) {
    await respondEphemeral(ctx, `Invalid list name \`${name}\`.`);
    return;
  }
  const { userIds, ignored } = parseUserMentions(mentionTokens);
  if (userIds.length === 0) {
    await respondEphemeral(
      ctx,
      `No valid user mentions in: ${ignored.map((t) => `\`${t}\``).join(", ")}.`,
    );
    return;
  }
  let removed = 0;
  let notMembers = 0;
  try {
    for (const id of userIds) {
      const didRemove = await removeMember(ctx.teamId, name, id);
      if (didRemove) removed += 1;
      else notMembers += 1;
    }
  } catch (err) {
    if (err instanceof ListNotFoundError) {
      await respondEphemeral(ctx, `No list named \`${err.listName}\`.`);
      return;
    }
    throw err;
  }
  const parts: string[] = [
    `Removed ${removed} from \`${name.toLowerCase()}\`.`,
  ];
  if (notMembers > 0) {
    parts.push(
      `${notMembers} ${notMembers === 1 ? "was" : "were"} not a member.`,
    );
  }
  if (ignored.length > 0) {
    parts.push(
      `Ignored: ${ignored.map((t) => `\`${t}\``).join(", ")}.`,
    );
  }
  await respondEphemeral(ctx, parts.join(" "));
}

async function actionShow(
  ctx: SubcommandContext,
  rest: readonly string[],
): Promise<void> {
  const name = rest[0];
  if (!name) {
    await respondEphemeral(ctx, "Usage: `/meenie list show <name>`");
    return;
  }
  if (!isValidName(name)) {
    await respondEphemeral(ctx, `Invalid list name \`${name}\`.`);
    return;
  }
  const list = await showList(ctx.teamId, name);
  if (!list) {
    await respondEphemeral(ctx, `No list named \`${name.toLowerCase()}\`.`);
    return;
  }
  await ctx.respond({
    response_type: "ephemeral",
    text:
      list.memberIds.length === 0
        ? `List \`${list.name}\` has no members yet.`
        : `List \`${list.name}\` (${list.memberIds.length} member${list.memberIds.length === 1 ? "" : "s"}): ${list.memberIds.map((id) => `<@${id}>`).join(", ")}`,
    blocks: listShowBlocks(list.name, list.memberIds),
  });
}

registerSubcommand("list", async (ctx) => {
  const [action, ...rest] = ctx.args;
  const verb = action?.toLowerCase();

  switch (verb) {
    case undefined:
    case "":
    case "index":
    case "ls":
    case "list":
      await actionIndex(ctx);
      return;
    case "create":
    case "new":
      await actionCreate(ctx, rest);
      return;
    case "delete":
    case "del":
    case "rm-list":
      await actionDelete(ctx, rest);
      return;
    case "add":
      await actionAdd(ctx, rest);
      return;
    case "remove":
    case "rm":
      await actionRemove(ctx, rest);
      return;
    case "show":
    case "members":
      await actionShow(ctx, rest);
      return;
    default:
      await respondEphemeral(
        ctx,
        `Unknown list action: \`${action}\`. Try \`create\`, \`add\`, \`remove\`, \`show\`, \`delete\`, or no args to list all.`,
      );
  }
});
