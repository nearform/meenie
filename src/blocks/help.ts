/**
 * Block Kit fragment for `/meenie help`. Kept separate from the handler so the
 * handler stays a thin wire-up and the content can be unit-tested without
 * pulling Bolt into the test runtime.
 *
 * The set of bullets is driven by `listSubcommands()` from the router, so new
 * subcommands registered by future stories (e.g. P2a `stats`) appear in the
 * help output without anyone having to edit this file. Unknown names fall back
 * to a generic syntax/description so a partial deploy never leaves a blank.
 */

import { types as slackTypes } from "@slack/bolt";
import { listSubcommands } from "../router.ts";

type KnownBlock = slackTypes.KnownBlock;

interface Usage {
  readonly syntax: string;
  readonly desc: string;
}

const USAGE: Record<string, Usage> = {
  pick: {
    syntax: "/meenie pick [#channel | @list]",
    desc:
      "Pick a member at random. Fairness-weighted: members picked recently are deprioritised so the load spreads evenly over time.",
  },
  list: {
    syntax: "/meenie list <create|add|remove|show|delete> ...",
    desc: "Manage custom pick lists.",
  },
  stats: {
    syntax: "/meenie stats [#channel | @list]",
    desc:
      "Show per-member pick counts (last 30 days). This is the same window the fairness picker reasons about.",
  },
  help: {
    syntax: "/meenie help",
    desc: "Show this help message.",
  },
};

const TAGLINE = "Pick someone at random from a Slack channel or a custom list.";

const AUTOMATION =
  "Combine with Slack's `/remind` for scheduled picks. Example: `/remind #standup to /meenie pick every Monday at 9am`. Picks are weighted against the 30-day audit so the same people don't get picked over and over — see `/meenie stats`.";

function usageFor(name: string): Usage {
  return USAGE[name] ?? { syntax: `/meenie ${name}`, desc: "(no description)" };
}

export function helpBlocks(): { blocks: KnownBlock[]; text: string } {
  const usages = listSubcommands().map(usageFor);

  const bulletMrkdwn = usages
    .map(({ syntax, desc }) => `• \`${syntax}\` — ${desc}`)
    .join("\n");

  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "meenie — pick someone at random" },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: TAGLINE },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          usages.length === 0
            ? "_No subcommands wired up yet._"
            : bulletMrkdwn,
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: AUTOMATION }],
    },
  ];

  const textLines = [
    "meenie — pick someone at random",
    TAGLINE,
    "",
    ...usages.map(({ syntax, desc }) => `${syntax}  —  ${desc}`),
    "",
    "Combine with Slack's /remind for scheduled picks. Example: /remind #standup to /meenie pick every Monday at 9am",
  ];

  return { blocks, text: textLines.join("\n") };
}
