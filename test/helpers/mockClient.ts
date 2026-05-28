import { vi } from "vitest";

/**
 * Minimal shape of the Slack user payload that `pickFromChannel` actually
 * consults. Keeping it small so test fixtures stay focused on the fields
 * that drive the filter (is_bot / deleted / id).
 */
export interface MockUser {
  id: string;
  is_bot?: boolean;
  deleted?: boolean;
  name?: string;
}

export interface MockClientOptions {
  members?: string[];
  users?: MockUser[];
}

/**
 * Returns an object shaped like the slice of `WebClient` that
 * `pickFromChannel` exercises (`conversations.members`, `users.info`), plus
 * a manual `usersById` lookup so we can return per-user payloads from a
 * single `users.info` mock.
 *
 * The returned methods are `vi.fn()` so tests can assert call counts /
 * arguments where it matters.
 */
export function makeMockClient(opts: MockClientOptions = {}) {
  const usersById = new Map<string, MockUser>(
    (opts.users ?? []).map((u) => [u.id, u]),
  );

  const conversationsMembers = vi.fn(async (_args: { channel: string }) => ({
    ok: true,
    members: opts.members ?? [],
  }));

  const usersInfo = vi.fn(async (args: { user: string }) => {
    const user = usersById.get(args.user);
    if (!user) {
      return { ok: false, user: undefined };
    }
    return { ok: true, user };
  });

  return {
    conversations: { members: conversationsMembers },
    users: { info: usersInfo },
  };
}

export type MockClient = ReturnType<typeof makeMockClient>;
