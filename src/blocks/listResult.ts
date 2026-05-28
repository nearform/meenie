/**
 * Block Kit fragments for `/meenie list ...` responses. Kept separate from the
 * handler so the handler stays a thin dispatcher.
 *
 * We declare a minimal structural block type locally rather than depending on
 * `@slack/types` (a transitive-only dep) or trying to extract one from the
 * `RespondArguments` discriminated union (where `blocks` only appears on the
 * `ChannelAndBlocks` variant and is not surfaced at the union level). The
 * returned objects are still accepted by `respond({ blocks: [...] })`.
 */

interface MrkdwnText {
  type: "mrkdwn";
  text: string;
}

interface SectionBlock {
  type: "section";
  text: MrkdwnText;
}

interface ContextBlock {
  type: "context";
  elements: MrkdwnText[];
}

export type ListBlock = SectionBlock | ContextBlock;

export function listShowBlocks(
  name: string,
  memberIds: readonly string[],
): ListBlock[] {
  const header: SectionBlock = {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*List \`${name}\`* — ${memberIds.length} member${
        memberIds.length === 1 ? "" : "s"
      }`,
    },
  };

  if (memberIds.length === 0) {
    return [
      header,
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text:
              "_No members yet._ Add some with `/meenie list add " +
              name +
              " @user`.",
          },
        ],
      },
    ];
  }

  return [
    header,
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: memberIds.map((id) => `• <@${id}>`).join("\n"),
      },
    },
  ];
}

export function listIndexBlocks(
  lists: ReadonlyArray<{ name: string; memberCount: number }>,
): ListBlock[] {
  if (lists.length === 0) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*No lists yet.*\nCreate one with `/meenie list create <name>`, " +
            "then add people with `/meenie list add <name> @user`.",
        },
      },
    ];
  }

  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Lists (${lists.length})*` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: lists
          .map(
            (l) =>
              `• \`${l.name}\` _(${l.memberCount} member${
                l.memberCount === 1 ? "" : "s"
              })_`,
          )
          .join("\n"),
      },
    },
  ];
}
