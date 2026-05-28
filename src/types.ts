/**
 * Frozen domain types. Do not change inside parallel phases (P1+).
 * Cross-cutting changes are sync-point activities.
 */

export type TeamId = string;
export type SlackUserId = string;
export type ChannelId = string;
export type ListId = string;

export type Scope =
  | { type: "channel"; id: ChannelId }
  | { type: "list"; id: ListId };

export type RandomFn = () => number;
