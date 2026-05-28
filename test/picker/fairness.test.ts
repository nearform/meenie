import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/slack.ts", () => ({
  getClientForTeam: vi.fn(),
  boltApp: { command: vi.fn(), action: vi.fn() },
}));

vi.mock("../../src/stats/index.ts", () => ({
  recordPick: vi.fn(),
  recordPicks: vi.fn(),
  getStats: vi.fn(),
  getPickCounts: vi.fn(async () => new Map<string, number>()),
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

const { recencyWeights, DEFAULT_FAIRNESS_WINDOW_DAYS } = await import(
  "../../src/picker/fairness.ts"
);
const { pickWeighted } = await import("../../src/picker/index.ts");
const { mulberry32 } = await import("../helpers/rng.ts");

describe("recencyWeights — weight policy", () => {
  it("never-picked member gets weight 1", () => {
    const w = recencyWeights(["U1"], new Map());
    expect(w).toEqual([1]);
  });

  it("picked once gets weight 1/2; twice 1/3; five times 1/6", () => {
    const counts = new Map([
      ["U1", 1],
      ["U2", 2],
      ["U3", 5],
    ]);
    const w = recencyWeights(["U1", "U2", "U3"], counts);
    expect(w[0]).toBeCloseTo(1 / 2, 12);
    expect(w[1]).toBeCloseTo(1 / 3, 12);
    expect(w[2]).toBeCloseTo(1 / 6, 12);
  });

  it("output is positionally aligned with memberIds", () => {
    // If someone refactors to a Map intermediate that loses insertion order,
    // this is the canary.
    const counts = new Map([
      ["B", 3],
      ["A", 0],
    ]);
    const w = recencyWeights(["A", "B"], counts);
    expect(w[0]).toBe(1); // A: never picked
    expect(w[1]).toBeCloseTo(1 / 4, 12); // B: picked 3 times
  });

  it("members with no entry default to weight 1 (fresh)", () => {
    const counts = new Map([["EXISTING", 4]]);
    const w = recencyWeights(["FRESH", "EXISTING"], counts);
    expect(w[0]).toBe(1);
    expect(w[1]).toBeCloseTo(1 / 5, 12);
  });

  it("returns an empty array for an empty member list", () => {
    expect(recencyWeights([], new Map())).toEqual([]);
  });

  it("exposes a 30-day default window matching /meenie stats", () => {
    // Documented contract: the audit window the user sees in /meenie stats
    // is the same window the fairness picker reasons about.
    expect(DEFAULT_FAIRNESS_WINDOW_DAYS).toBe(30);
  });
});

describe("pickWeighted — weighted sampling without replacement", () => {
  it("equal weights match uniform — over 24,000 single draws, ±10% per bucket", () => {
    const pool = ["U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8"];
    const weights = pool.map(() => 1);
    const rng = mulberry32(0xfa1e);
    const counts = new Map<string, number>(pool.map((id) => [id, 0]));

    for (let i = 0; i < 24_000; i++) {
      const [picked] = pickWeighted(rng, pool, weights, 1);
      counts.set(picked as string, (counts.get(picked as string) ?? 0) + 1);
    }

    const expected = 24_000 / pool.length;
    const tolerance = expected * 0.1;
    for (const id of pool) {
      expect(Math.abs((counts.get(id) ?? 0) - expected)).toBeLessThan(tolerance);
    }
  });

  it("a 4× heavier weight is drawn ~4× more often than a baseline peer", () => {
    // The single most important behavioural assertion in this file: the bias
    // goes in the right direction *and* the magnitude is roughly right.
    const pool = ["heavy", "light1", "light2", "light3"];
    const weights = [4, 1, 1, 1];
    const rng = mulberry32(0xb14);
    const counts = new Map<string, number>(pool.map((id) => [id, 0]));

    for (let i = 0; i < 35_000; i++) {
      const [picked] = pickWeighted(rng, pool, weights, 1);
      counts.set(picked as string, (counts.get(picked as string) ?? 0) + 1);
    }

    const heavy = counts.get("heavy") ?? 0;
    const lightAvg =
      ((counts.get("light1") ?? 0) +
        (counts.get("light2") ?? 0) +
        (counts.get("light3") ?? 0)) /
      3;
    // Expected ratio is exactly 4. ±15% lets the test ride out RNG variance
    // while still falling over if the bias is half-strength or backwards.
    const ratio = heavy / lightAvg;
    expect(ratio).toBeGreaterThan(4 * 0.85);
    expect(ratio).toBeLessThan(4 * 1.15);
  });

  it("a zero-weight member is never picked while peers have positive weight", () => {
    const pool = ["banned", "ok1", "ok2", "ok3"];
    const weights = [0, 1, 1, 1];
    const rng = mulberry32(0xdab);
    for (let i = 0; i < 2_000; i++) {
      const [picked] = pickWeighted(rng, pool, weights, 1);
      expect(picked).not.toBe("banned");
    }
  });

  it("when ALL weights are zero, falls back to uniform instead of looping", () => {
    const pool = ["A", "B", "C", "D"];
    const weights = [0, 0, 0, 0];
    const rng = mulberry32(0xabcd);
    const counts = new Map<string, number>(pool.map((id) => [id, 0]));
    for (let i = 0; i < 8_000; i++) {
      const [picked] = pickWeighted(rng, pool, weights, 1);
      counts.set(picked as string, (counts.get(picked as string) ?? 0) + 1);
    }
    // Each ≈ 2000 ± 15%.
    for (const id of pool) {
      expect(Math.abs((counts.get(id) ?? 0) - 2_000)).toBeLessThan(300);
    }
  });

  it("NaN / Infinity / negative weights are coerced to zero (defensive)", () => {
    const pool = ["nan", "inf", "neg", "ok"];
    const weights = [Number.NaN, Number.POSITIVE_INFINITY, -1, 1];
    const rng = mulberry32(99);
    // ok has weight 1, the rest coerce to 0 → ok is always picked.
    for (let i = 0; i < 200; i++) {
      const [picked] = pickWeighted(rng, pool, weights, 1);
      expect(picked).toBe("ok");
    }
  });

  it("does not return duplicates within a single weighted multi-draw", () => {
    const pool = ["A", "B", "C", "D", "E"];
    const weights = [1, 4, 1, 4, 1]; // unequal, exercising the swap path
    const rng = mulberry32(2024);
    for (let i = 0; i < 1_000; i++) {
      const drawn = pickWeighted(rng, pool, weights, 3);
      expect(drawn).toHaveLength(3);
      expect(new Set(drawn).size).toBe(3);
    }
  });

  it("returns all members when n exceeds the pool length (matches `pick`)", () => {
    const pool = ["A", "B", "C"];
    const weights = [1, 1, 1];
    const drawn = pickWeighted(mulberry32(1), pool, weights, 99);
    expect(drawn).toHaveLength(3);
    expect(new Set(drawn)).toEqual(new Set(pool));
  });

  it("throws if members and weights have mismatched lengths", () => {
    expect(() =>
      pickWeighted(mulberry32(1), ["A", "B"], [1], 1),
    ).toThrowError(/members\.length .* !== weights\.length/);
  });

  it("throws on empty pool — matches `pick`'s shape contract", () => {
    expect(() => pickWeighted(mulberry32(1), [], [], 1)).toThrowError(
      "no members to pick from",
    );
  });

  it("does not mutate input arrays", () => {
    const pool = ["A", "B", "C", "D"];
    const weights = [1, 2, 3, 4];
    const poolSnap = [...pool];
    const weightSnap = [...weights];
    pickWeighted(mulberry32(7), pool, weights, 2);
    expect(pool).toEqual(poolSnap);
    expect(weights).toEqual(weightSnap);
  });
});

describe("end-to-end fairness: recencyWeights + pickWeighted in concert", () => {
  it("simulating a daily standup pick converges total picks toward equality despite a head start", () => {
    // Scenario: a 7-person standup. Alice (U_ALICE) has already been picked
    // 5 times in the window before the simulation starts; everyone else 0.
    // Under naïve uniform random, Alice's *future* expected share is 1/7
    // (~14%) per day — her existing 5-pick lead would never close.
    // Under recency-weighted picks, her weight starts at 1/6 against
    // everyone else's 1; her future share is small, so the totals converge.
    const pool = [
      "U_ALICE",
      "U_BOB",
      "U_CAROL",
      "U_DAVE",
      "U_EVE",
      "U_FRANK",
      "U_GINA",
    ];
    const counts = new Map<string, number>(pool.map((id) => [id, 0]));
    counts.set("U_ALICE", 5); // head start
    const rng = mulberry32(0xfa12);

    // Simulate 200 daily picks.
    for (let day = 0; day < 200; day++) {
      const weights = recencyWeights(pool, counts);
      const [picked] = pickWeighted(rng, pool, weights, 1);
      counts.set(picked as string, (counts.get(picked as string) ?? 0) + 1);
    }

    // The fairness criterion: by the end of the simulation, the *gap*
    // between the most-picked and least-picked member is small relative to
    // the per-member expectation. With 200 picks across 7 members the
    // expected per-member count is ~28.6 — but Alice came in with +5. A
    // perfect recency picker would tighten the spread to within a few picks.
    const values = pool.map((id) => counts.get(id) ?? 0);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const spread = max - min;
    expect(spread).toBeLessThanOrEqual(10);

    // And Alice — who started 5 picks ahead — should not still be in the
    // lead by a wide margin. The bias actively pulls her *back*.
    const aliceCount = counts.get("U_ALICE") ?? 0;
    const otherAvg =
      values.filter((_, i) => pool[i] !== "U_ALICE").reduce((a, b) => a + b, 0) /
      (pool.length - 1);
    expect(aliceCount - otherAvg).toBeLessThan(5);
  });

  it("vs uniform random: fairness erases a pre-existing head start, uniform leaves it in place", () => {
    // The side-by-side comparison that's actually robust. Setup: HEAVY has
    // already been picked 10 times. Then we do `draws` further picks.
    //   - Under uniform, HEAVY's lead persists. Random walks around their
    //     initial state; in expectation the lead is preserved exactly.
    //   - Under fairness, HEAVY's weight is initially 1/11 against everyone
    //     else's 1, so they are picked far less often. The lead closes.
    // Comparing the final max-min spread isolates the bias from RNG luck.
    const pool = ["HEAVY", "A", "B", "C", "D", "E", "F"];
    const headStart = 10;
    const draws = 250;

    // Uniform pass — pool weights are constant `1`s, ignoring history.
    const uniformCounts = new Map<string, number>(pool.map((id) => [id, 0]));
    uniformCounts.set("HEAVY", headStart);
    const rngUniform = mulberry32(0xa11);
    for (let i = 0; i < draws; i++) {
      const weights = pool.map(() => 1);
      const [picked] = pickWeighted(rngUniform, pool, weights, 1);
      uniformCounts.set(
        picked as string,
        (uniformCounts.get(picked as string) ?? 0) + 1,
      );
    }
    const uniformValues = pool.map((id) => uniformCounts.get(id) ?? 0);
    const uniformSpread = Math.max(...uniformValues) - Math.min(...uniformValues);

    // Fairness pass — same RNG seed, but weights are rebuilt from history
    // each draw, so the head start is repaid over time.
    const fairCounts = new Map<string, number>(pool.map((id) => [id, 0]));
    fairCounts.set("HEAVY", headStart);
    const rngFair = mulberry32(0xa11);
    for (let i = 0; i < draws; i++) {
      const weights = recencyWeights(pool, fairCounts);
      const [picked] = pickWeighted(rngFair, pool, weights, 1);
      fairCounts.set(
        picked as string,
        (fairCounts.get(picked as string) ?? 0) + 1,
      );
    }
    const fairValues = pool.map((id) => fairCounts.get(id) ?? 0);
    const fairSpread = Math.max(...fairValues) - Math.min(...fairValues);

    // Two assertions:
    //   1. Fairness produces a strictly tighter spread.
    //   2. The gap is meaningful, not noise — head start is 10, so we expect
    //      uniform to be ~10+noise wide while fairness should close the
    //      initial lead and only leave ~sqrt(draws) noise.
    expect(fairSpread).toBeLessThan(uniformSpread);
    expect(fairSpread + 5).toBeLessThan(uniformSpread);
  });
});
