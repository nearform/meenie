import { afterEach, describe, expect, it, vi } from "vitest";

const resolveListMembers =
  vi.fn<(teamId: string, name: string) => Promise<string[]>>();
const recordPicks =
  vi.fn<
    (
      teamId: string,
      scope: { type: "channel" | "list"; id: string },
      pickedUserIds: readonly string[],
    ) => Promise<void>
  >();

class ListNotFoundError extends Error {
  readonly listName: string;
  constructor(listName: string) {
    super(`List "${listName}" not found`);
    this.name = "ListNotFoundError";
    this.listName = listName;
  }
}

vi.mock("../../src/lists/index.ts", () => ({
  resolveListMembers,
  ListNotFoundError,
  ListAlreadyExistsError: class extends Error {},
  createList: vi.fn(),
  deleteList: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  showList: vi.fn(),
  listAllLists: vi.fn(),
}));

vi.mock("../../src/stats/index.ts", () => ({
  recordPicks,
  recordPick: vi.fn(async () => undefined),
  getStats: vi.fn(),
}));

// Slack is reachable from pickFromChannel through the same module; mock it
// so importing src/picker/index.ts doesn't pull in @slack/bolt.
vi.mock("../../src/slack.ts", () => ({
  getClientForTeam: vi.fn(),
  boltApp: { command: vi.fn(), action: vi.fn() },
}));

const { pickFromList } = await import("../../src/picker/index.ts");

describe("pickFromList", () => {
  afterEach(() => {
    resolveListMembers.mockReset();
    recordPicks.mockClear();
  });

  it("returns { picked: [], total: 0 } for an empty list without picking", async () => {
    resolveListMembers.mockResolvedValueOnce([]);
    const result = await pickFromList("T1", "my-list");
    expect(result).toEqual({ picked: [], total: 0 });
    expect(recordPicks).not.toHaveBeenCalled();
  });

  it("propagates ListNotFoundError from resolveListMembers", async () => {
    resolveListMembers.mockRejectedValueOnce(new ListNotFoundError("ghost"));
    await expect(pickFromList("T1", "ghost")).rejects.toBeInstanceOf(
      ListNotFoundError,
    );
    expect(recordPicks).not.toHaveBeenCalled();
  });

  it("picks one of the list's members on the happy path", async () => {
    resolveListMembers.mockResolvedValueOnce(["U1", "U2", "U3"]);
    const result = await pickFromList("T1", "team");
    expect(result.total).toBe(3);
    expect(result.picked).toHaveLength(1);
    expect(["U1", "U2", "U3"]).toContain(result.picked[0]);
  });

  it("records picks with the list scope using the list name as the id", async () => {
    resolveListMembers.mockResolvedValueOnce(["U1", "U2"]);
    const result = await pickFromList("T1", "team");
    expect(recordPicks).toHaveBeenCalledTimes(1);
    const call = recordPicks.mock.calls[0];
    if (!call) throw new Error("recordPicks was not called");
    const [teamId, scope, ids] = call;
    expect(teamId).toBe("T1");
    expect(scope).toEqual({ type: "list", id: "team" });
    expect(ids).toEqual(result.picked);
  });
});
