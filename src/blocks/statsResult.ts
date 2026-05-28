/**
 * Block Kit fragments for `/meenie stats`. Mirrors the pickResult convention:
 * a section header, a context line with summary metadata, then a body section
 * with the per-member tallies. All responses are ephemeral so the handler
 * decides the `response_type`.
 */

import { types as slackTypes } from "@slack/bolt";
import type { Scope } from "../types.ts";
import type { StatsResult } from "../stats/index.ts";

type KnownBlock = slackTypes.KnownBlock;

const MAX_MEMBER_ROWS = 25;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function describeScope(scope: Scope): string {
  return scope.type === "channel" ? `<#${scope.id}>` : `the *${scope.id}* list`;
}

function describeScopePlain(scope: Scope): string {
  return scope.type === "channel" ? `#${scope.id}` : `@${scope.id}`;
}

/**
 * Format an ISO timestamp as "Mon DD, HH:MM" in UTC. We do this manually
 * rather than via `Intl.DateTimeFormat` so the output is stable across hosts
 * regardless of the server's ICU data, and so the unit shape stays trivial
 * to assert in tests.
 */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const month = MONTHS[d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day}, ${hh}:${mm}`;
}

export function statsResultBlocks(input: StatsResult): {
  blocks: KnownBlock[];
  text: string;
} {
  const { scope, windowDays, totalPicks, perMember, lastPickedAt } = input;
  const where = describeScope(scope);
  const wherePlain = describeScopePlain(scope);

  const headerText = `*Pick stats for ${where}* _(last ${windowDays} days)_`;

  const lastBit = lastPickedAt
    ? `last on ${formatTimestamp(lastPickedAt)}`
    : "no picks yet";
  const contextText = `${totalPicks} pick${totalPicks === 1 ? "" : "s"} recorded · ${lastBit}`;

  const shown = perMember.slice(0, MAX_MEMBER_ROWS);
  const remaining = perMember.length - shown.length;
  const bodyLines = shown.map(
    (m) => `• <@${m.userId}> · ${m.count} pick${m.count === 1 ? "" : "s"}`,
  );
  if (remaining > 0) {
    bodyLines.push(`_… and ${remaining} more_`);
  }

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: headerText },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: contextText }],
    },
  ];

  if (bodyLines.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: bodyLines.join("\n") },
    });
  }

  const text = `Pick stats for ${wherePlain}: ${totalPicks} pick${totalPicks === 1 ? "" : "s"} in the last ${windowDays} days.`;

  return { blocks, text };
}
