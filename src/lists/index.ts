/**
 * Lists service: CRUD for custom workspace lists and their members.
 *
 * Frozen contract surface (consumed by P1a's Phase-1 sync to support
 * `/meeny pick @list-name`):
 *
 *   resolveListMembers(teamId, name): Promise<SlackUserId[]>
 *
 * Names are validated by the handler against `/^[a-z0-9][a-z0-9_-]{0,31}$/i`.
 * This module additionally lowercases names so that `@Engineering` and
 * `@engineering` resolve to the same list.
 */

import { query, queryOne } from "../db.ts";
import type { ListId, SlackUserId, TeamId } from "../types.ts";

const PG_UNIQUE_VIOLATION = "23505";

export class ListNotFoundError extends Error {
  readonly listName: string;
  constructor(listName: string) {
    super(`List "${listName}" not found`);
    this.name = "ListNotFoundError";
    this.listName = listName;
  }
}

export class ListAlreadyExistsError extends Error {
  readonly listName: string;
  constructor(listName: string) {
    super(`List "${listName}" already exists`);
    this.name = "ListAlreadyExistsError";
    this.listName = listName;
  }
}

function isPgError(err: unknown): err is { code: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  );
}

function normaliseName(name: string): string {
  return name.toLowerCase();
}

interface ListRow {
  id: string;
  name: string;
}

interface ListWithCountRow {
  id: string;
  name: string;
  member_count: string;
}

interface MemberRow {
  slack_user_id: string;
}

async function findListId(teamId: TeamId, name: string): Promise<ListId | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id::text AS id FROM lists WHERE team_id = $1 AND name = $2`,
    [teamId, normaliseName(name)],
  );
  return row?.id ?? null;
}

export async function createList(
  teamId: TeamId,
  name: string,
): Promise<{ id: ListId; name: string }> {
  const normalised = normaliseName(name);
  try {
    const row = await queryOne<ListRow>(
      `INSERT INTO lists (team_id, name)
       VALUES ($1, $2)
       RETURNING id::text AS id, name`,
      [teamId, normalised],
    );
    if (!row) {
      throw new Error(`Insert into lists returned no row for "${normalised}"`);
    }
    return { id: row.id, name: row.name };
  } catch (err) {
    if (isPgError(err) && err.code === PG_UNIQUE_VIOLATION) {
      throw new ListAlreadyExistsError(normalised);
    }
    throw err;
  }
}

export async function deleteList(teamId: TeamId, name: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM lists
     WHERE team_id = $1 AND name = $2
     RETURNING id::text AS id`,
    [teamId, normaliseName(name)],
  );
  return rows.length > 0;
}

export async function addMember(
  teamId: TeamId,
  listName: string,
  slackUserId: SlackUserId,
): Promise<void> {
  const listId = await findListId(teamId, listName);
  if (listId === null) throw new ListNotFoundError(normaliseName(listName));
  await query(
    `INSERT INTO list_members (list_id, slack_user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [listId, slackUserId],
  );
}

export async function removeMember(
  teamId: TeamId,
  listName: string,
  slackUserId: SlackUserId,
): Promise<boolean> {
  const listId = await findListId(teamId, listName);
  if (listId === null) throw new ListNotFoundError(normaliseName(listName));
  const rows = await query<{ slack_user_id: string }>(
    `DELETE FROM list_members
     WHERE list_id = $1 AND slack_user_id = $2
     RETURNING slack_user_id`,
    [listId, slackUserId],
  );
  return rows.length > 0;
}

export async function showList(
  teamId: TeamId,
  name: string,
): Promise<{ id: ListId; name: string; memberIds: SlackUserId[] } | null> {
  const list = await queryOne<ListRow>(
    `SELECT id::text AS id, name FROM lists WHERE team_id = $1 AND name = $2`,
    [teamId, normaliseName(name)],
  );
  if (!list) return null;
  const members = await query<MemberRow>(
    `SELECT slack_user_id
     FROM list_members
     WHERE list_id = $1
     ORDER BY added_at ASC, slack_user_id ASC`,
    [list.id],
  );
  return {
    id: list.id,
    name: list.name,
    memberIds: members.map((m) => m.slack_user_id),
  };
}

/**
 * Frozen contract for P1a's Phase-1 sync. Throws `ListNotFoundError` when the
 * list does not exist; returns `[]` for an existing but empty list.
 */
export async function resolveListMembers(
  teamId: TeamId,
  name: string,
): Promise<SlackUserId[]> {
  const list = await queryOne<{ id: string }>(
    `SELECT id::text AS id FROM lists WHERE team_id = $1 AND name = $2`,
    [teamId, normaliseName(name)],
  );
  if (!list) throw new ListNotFoundError(normaliseName(name));
  const members = await query<MemberRow>(
    `SELECT slack_user_id
     FROM list_members
     WHERE list_id = $1
     ORDER BY added_at ASC, slack_user_id ASC`,
    [list.id],
  );
  return members.map((m) => m.slack_user_id);
}

export async function listAllLists(
  teamId: TeamId,
): Promise<Array<{ id: ListId; name: string; memberCount: number }>> {
  const rows = await query<ListWithCountRow>(
    `SELECT l.id::text AS id,
            l.name,
            COUNT(m.slack_user_id)::text AS member_count
     FROM lists l
     LEFT JOIN list_members m ON m.list_id = l.id
     WHERE l.team_id = $1
     GROUP BY l.id, l.name
     ORDER BY l.name ASC`,
    [teamId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    memberCount: Number.parseInt(r.member_count, 10),
  }));
}
