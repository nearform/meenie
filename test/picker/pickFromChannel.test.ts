import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockClient, type MockClient } from "../helpers/mockClient.ts";

let currentClient: MockClient;
const recordPicks =
  vi.fn<
    (
      teamId: string,
      scope: { type: "channel" | "list"; id: string },
      pickedUserIds: readonly string[],
    ) => Promise<void>
  >();

vi.mock("../../src/slack.ts", () => ({
  getClientForTeam: vi.fn(async () => currentClient),
  boltApp: {
    command: vi.fn(),
    action: vi.fn(),
  },
}));

vi.mock("../../src/stats/index.ts", () => ({
  recordPicks,
  recordPick: vi.fn(async () => undefined),
  getStats: vi.fn(),
  // Empty history → recencyWeights returns all 1s → pickWeighted degrades to
  // uniform, matching the assertions in this file (which predate fairness).
  getPickCounts: vi.fn(async () => new Map<string, number>()),
}));

// Pull the SUT in *after* the mocks are declared so the real module body
// resolves the mocked dependencies.
const { pickFromChannel } = await import("../../src/picker/index.ts");

describe("pickFromChannel", () => {
  beforeEach(() => {
    currentClient = makeMockClient();
  });

  afterEach(() => {
    recordPicks.mockClear();
  });

  it("returns { picked: [], total: 0 } for an empty channel", async () => {
    currentClient = makeMockClient({ members: [], users: [] });
    const result = await pickFromChannel("T1", "C1");
    expect(result).toEqual({ picked: [], total: 0 });
    expect(recordPicks).not.toHaveBeenCalled();
  });

  it("filters out bots", async () => {
    currentClient = makeMockClient({
      members: ["U_HUMAN", "U_BOT"],
      users: [
        { id: "U_HUMAN" },
        { id: "U_BOT", is_bot: true },
      ],
    });
    const result = await pickFromChannel("T1", "C1");
    expect(result.total).toBe(1);
    expect(result.picked).toEqual(["U_HUMAN"]);
  });

  it("filters out deactivated users", async () => {
    currentClient = makeMockClient({
      members: ["U_LIVE", "U_GONE"],
      users: [
        { id: "U_LIVE" },
        { id: "U_GONE", deleted: true },
      ],
    });
    const result = await pickFromChannel("T1", "C1");
    expect(result.total).toBe(1);
    expect(result.picked).toEqual(["U_LIVE"]);
  });

  it("filters out Slackbot (USLACKBOT)", async () => {
    currentClient = makeMockClient({
      members: ["USLACKBOT", "U_REAL"],
      users: [
        { id: "USLACKBOT" },
        { id: "U_REAL" },
      ],
    });
    const result = await pickFromChannel("T1", "C1");
    expect(result.total).toBe(1);
    expect(result.picked).toEqual(["U_REAL"]);
  });

  it("returns { picked: [], total: 0 } when every member is filtered", async () => {
    currentClient = makeMockClient({
      members: ["U_BOT", "USLACKBOT", "U_DEAD"],
      users: [
        { id: "U_BOT", is_bot: true },
        { id: "USLACKBOT" },
        { id: "U_DEAD", deleted: true },
      ],
    });
    const result = await pickFromChannel("T1", "C1");
    expect(result).toEqual({ picked: [], total: 0 });
    expect(recordPicks).not.toHaveBeenCalled();
  });

  it("happy path: picks a human, reports total=3 with one bot present", async () => {
    currentClient = makeMockClient({
      members: ["U_A", "U_B", "U_C", "U_BOT"],
      users: [
        { id: "U_A" },
        { id: "U_B" },
        { id: "U_C" },
        { id: "U_BOT", is_bot: true },
      ],
    });
    const result = await pickFromChannel("T1", "C123");
    expect(result.total).toBe(3);
    expect(result.picked).toHaveLength(1);
    expect(["U_A", "U_B", "U_C"]).toContain(result.picked[0]);
  });

  it("awaits recordPicks with the picked IDs and the channel scope", async () => {
    currentClient = makeMockClient({
      members: ["U_A", "U_B"],
      users: [{ id: "U_A" }, { id: "U_B" }],
    });
    const result = await pickFromChannel("T1", "C123");
    expect(recordPicks).toHaveBeenCalledTimes(1);
    const call = recordPicks.mock.calls[0];
    if (!call) throw new Error("recordPicks was not called");
    const [teamId, scope, ids] = call;
    expect(teamId).toBe("T1");
    expect(scope).toEqual({ type: "channel", id: "C123" });
    expect(ids).toEqual(result.picked);
  });

  it("calls users.info once per channel member", async () => {
    currentClient = makeMockClient({
      members: ["U_A", "U_B", "U_C"],
      users: [{ id: "U_A" }, { id: "U_B" }, { id: "U_C" }],
    });
    await pickFromChannel("T1", "C1");
    expect(currentClient.users.info).toHaveBeenCalledTimes(3);
  });
});
