import { types as slackTypes } from "@slack/bolt";
import type { Scope } from "../types.ts";

type KnownBlock = slackTypes.KnownBlock;

export interface PickResultInput {
  scope: Scope;
  pickedUserIds: readonly string[];
  total: number;
}

/**
 * Serialise a `Scope` into a Block Kit button `value`. Channel IDs and list
 * names cannot contain `:` (channel IDs are `[CGD][A-Z0-9]+`; list names match
 * `[a-z0-9][a-z0-9_-]{0,31}`), so the simple `<type>:<id>` form is unambiguous.
 */
export function encodeScope(scope: Scope): string {
  return `${scope.type}:${scope.id}`;
}

export function decodeScope(value: string | undefined): Scope | null {
  if (!value) return null;
  const idx = value.indexOf(":");
  if (idx <= 0) return null;
  const type = value.slice(0, idx);
  const id = value.slice(idx + 1);
  if (!id) return null;
  if (type === "channel" || type === "list") {
    return { type, id } as Scope;
  }
  return null;
}

function describeScope(scope: Scope): string {
  return scope.type === "channel" ? `<#${scope.id}>` : `\`${scope.id}\``;
}

function describeScopeLong(scope: Scope): string {
  return scope.type === "channel"
    ? `<#${scope.id}>`
    : `the *${scope.id}* list`;
}

/**
 * Render the message Slack shows after a successful `/meenie pick`. The
 * `text` field is the fallback for notifications and accessibility clients;
 * the blocks carry the rich layout plus the `pick_again` button that calls
 * back into the handler with the scope encoded in the button value.
 */
export function pickResultBlocks(input: PickResultInput): {
  blocks: KnownBlock[];
  text: string;
} {
  const { scope, pickedUserIds, total } = input;
  const mentions = pickedUserIds.map((id) => `<@${id}>`).join(", ");
  const count = pickedUserIds.length;
  const verb = count === 1 ? "is" : "are";
  const where = describeScopeLong(scope);
  const whereShort = describeScope(scope);

  const headerText =
    count === 0
      ? `_No one to pick from ${where}._`
      : `${mentions} ${verb} up.`;

  const text =
    count === 0
      ? `No members to pick from ${whereShort}.`
      : `Picked ${mentions} from ${whereShort}.`;

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: headerText },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Picked ${count} of ${total} members in ${where}`,
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Pick again" },
          action_id: "pick_again",
          value: encodeScope(scope),
        },
      ],
    },
  ];

  return { blocks, text };
}
