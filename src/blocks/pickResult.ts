import { types as slackTypes } from "@slack/bolt";

type KnownBlock = slackTypes.KnownBlock;

export interface PickResultInput {
  channelId: string;
  pickedUserIds: readonly string[];
  total: number;
}

/**
 * Render the message Slack shows after a successful `/meeny pick`. The
 * `text` field is the fallback for notifications and accessibility clients;
 * the blocks carry the rich layout plus the `pick_again` button that calls
 * back into the handler.
 */
export function pickResultBlocks(input: PickResultInput): {
  blocks: KnownBlock[];
  text: string;
} {
  const { channelId, pickedUserIds, total } = input;
  const mentions = pickedUserIds.map((id) => `<@${id}>`).join(", ");
  const count = pickedUserIds.length;
  const verb = count === 1 ? "is" : "are";

  const headerText =
    count === 0
      ? `_No one to pick from <#${channelId}>._`
      : `${mentions} ${verb} up.`;

  const text =
    count === 0
      ? `No members to pick from <#${channelId}>.`
      : `Picked ${mentions} from <#${channelId}>.`;

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
          text: `Picked ${count} of ${total} members in <#${channelId}>`,
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
          value: channelId,
        },
      ],
    },
  ];

  return { blocks, text };
}
