import { describe, expect, it, vi } from "vitest";

// `src/picker/index.ts` imports `src/slack.ts` (for `getClientForTeam`),
// which constructs a Bolt ExpressReceiver at module load. The pure `pick`
// function we exercise here doesn't need any of that runtime, so we mock
// the dependency chain to skip the Bolt bootstrap.
vi.mock("../../src/slack.ts", () => ({
  getClientForTeam: vi.fn(),
  boltApp: { command: vi.fn(), action: vi.fn() },
}));

vi.mock("../../src/stats/index.ts", () => ({
  recordPick: vi.fn(),
  recordPicks: vi.fn(),
  getStats: vi.fn(),
}));

vi.mock("../../src/lists/index.ts", () => ({
  resolveListMembers: vi.fn(),
  ListNotFoundError: class extends Error {},
  ListAlreadyExistsError: class extends Error {},
  createList: vi.fn(),
  deleteList: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  showList: vi.fn(),
  listAllLists: vi.fn(),
}));

const { pick } = await import("../../src/picker/index.ts");
const { mulberry32 } = await import("../helpers/rng.ts");

describe("pick", () => {
  it("throws on an empty pool", () => {
    const rng = mulberry32(1);
    expect(() => pick(rng, [], 1)).toThrowError("no members to pick from");
  });

  it("returns the single member when the pool has one entry", () => {
    const rng = mulberry32(1);
    expect(pick(rng, ["U1"], 1)).toEqual(["U1"]);
  });

  it("returns [] when n=0", () => {
    const rng = mulberry32(1);
    expect(pick(rng, ["U1", "U2"], 0)).toEqual([]);
  });

  it("returns all members when n exceeds the pool length (no duplicates)", () => {
    const pool = ["U1", "U2", "U3", "U4"];
    const result = pick(mulberry32(42), pool, 10);
    expect(result).toHaveLength(pool.length);
    expect(new Set(result)).toEqual(new Set(pool));
  });

  it("treats negative n as 0", () => {
    expect(pick(mulberry32(1), ["U1", "U2"], -3)).toEqual([]);
  });

  it("is deterministic for a given seed", () => {
    const pool = ["U1", "U2", "U3", "U4", "U5"];
    const first = pick(mulberry32(123), pool, 3);
    const second = pick(mulberry32(123), pool, 3);
    expect(first).toEqual(second);
  });

  it("produces the exact expected output for a known seed", () => {
    // Snapshot of mulberry32(7) + the partial Fisher-Yates loop in pick.
    // If the algorithm changes this assertion catches the regression.
    const pool = ["U1", "U2", "U3", "U4", "U5"];
    const result = pick(mulberry32(7), pool, 3);
    expect(result).toEqual(["U1", "U2", "U5"]);
  });

  it("returns different output for diverging seeds", () => {
    const pool = ["U1", "U2", "U3", "U4", "U5"];
    const a = pick(mulberry32(7), pool, 3);
    const b = pick(mulberry32(99999), pool, 3);
    expect(a).not.toEqual(b);
  });

  it("does not mutate the input pool", () => {
    const pool = ["U1", "U2", "U3", "U4"];
    const snapshot = [...pool];
    pick(mulberry32(11), pool, 2);
    expect(pool).toEqual(snapshot);
  });

  it("output is stable regardless of object identity of the pool", () => {
    const pool = ["A", "B", "C", "D", "E"];
    const result1 = pick(mulberry32(5), pool, 4);
    const result2 = pick(mulberry32(5), [...pool], 4);
    expect(result1).toEqual(result2);
  });
});
