import { describe, expect, it, vi } from "vitest";

// Same scaffolding as pick.test.ts: src/picker/index.ts pulls in src/slack.ts
// which constructs an ExpressReceiver at module load. The pure `pick` we are
// exercising here has no need of any of that — mock the chain so the file
// loads cleanly in Node-only mode.
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

const { pick } = await import("../../src/picker/index.ts");
const { mulberry32 } = await import("../helpers/rng.ts");

/**
 * Statistical uniformity tests for `pick`.
 *
 * These guard the failure mode users actually hit with weak pickers: the
 * algorithm *looks* random but isn't. We are not testing the RNG itself
 * (mulberry32 is well-studied and so is V8's Math.random); we are testing
 * `pick`'s use of it. Off-by-one errors in the Fisher-Yates loop, a stuck
 * index, or a regression that biases toward the first member will be loudly
 * caught here.
 *
 * Tolerances are deliberately loose (±10% of expected) so they're robust
 * across CPUs and Node versions. With the sample sizes chosen, the tolerance
 * band is several standard deviations wide — the false-failure rate is in the
 * 1e-9 ballpark even with a perfectly uniform picker. If one of these tests
 * goes red, it is a real regression, not a flake.
 *
 * What is intentionally NOT tested here:
 *   - Anti-recency fairness ("don't pick the same person twice in a row").
 *     The current picker is uniform random by design, so consecutive repeats
 *     happen with probability 1/N. The roadmap item "Weighted 'fair' picks"
 *     is what introduces recency-aware bias; when that lands, this file
 *     needs new assertions, not these ones relaxed.
 */
describe("pick — statistical uniformity", () => {
  it("8 members × 24,000 single draws: every member lands within ±10% of expected (3,000)", () => {
    const pool = ["U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8"];
    const draws = 24_000;
    const rng = mulberry32(0xc0ffee);
    const counts = new Map<string, number>(pool.map((id) => [id, 0]));

    for (let i = 0; i < draws; i++) {
      const result = pick(rng, pool, 1);
      const picked = result[0] as string;
      counts.set(picked, (counts.get(picked) ?? 0) + 1);
    }

    const expected = draws / pool.length;
    const tolerance = expected * 0.1;
    for (const id of pool) {
      const c = counts.get(id) ?? 0;
      expect(Math.abs(c - expected)).toBeLessThan(tolerance);
    }

    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    expect(total).toBe(draws);
  });

  it("12 members × 10,000 single draws: every position gets picked at least 50× (no stuck-index regression)", () => {
    // Catches "always returns pool[0]", "never returns the last member", and
    // similar stuck-index bugs that uniform-tolerance checks could miss if the
    // bias happened to land near expected at the same time.
    const pool = Array.from({ length: 12 }, (_, i) => `U${i}`);
    const rng = mulberry32(424242);
    const counts = new Map<string, number>(pool.map((id) => [id, 0]));

    for (let i = 0; i < 10_000; i++) {
      const result = pick(rng, pool, 1);
      const picked = result[0] as string;
      counts.set(picked, (counts.get(picked) ?? 0) + 1);
    }

    for (const id of pool) {
      expect(counts.get(id) ?? 0).toBeGreaterThan(50);
    }
  });

  it("5 members × 5,000 draws of n=2 (without replacement): each member ≈ 2,000 ± 10%", () => {
    const pool = ["A", "B", "C", "D", "E"];
    const rng = mulberry32(0xdead);
    const counts = new Map<string, number>(pool.map((id) => [id, 0]));

    for (let i = 0; i < 5_000; i++) {
      for (const id of pick(rng, pool, 2)) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }

    const expected = 2_000;
    const tolerance = expected * 0.1;
    for (const id of pool) {
      expect(Math.abs((counts.get(id) ?? 0) - expected)).toBeLessThan(tolerance);
    }
  });

  it("first-returned member across 16,000 draws of n=3 is itself uniform (Fisher-Yates off-by-one canary)", () => {
    // The very first iteration of the loop is `j = floor(rng * pool.length)`,
    // ranging over [0, pool.length - 1]. If anyone "tidies" this to
    // `pool.length - 1` (a classic off-by-one), the last member would never
    // appear in position 0 and this test would go red.
    const pool = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const rng = mulberry32(0xbeef);
    const firstCounts = new Map<string, number>(pool.map((id) => [id, 0]));

    for (let i = 0; i < 16_000; i++) {
      const result = pick(rng, pool, 3);
      const first = result[0] as string;
      firstCounts.set(first, (firstCounts.get(first) ?? 0) + 1);
    }

    const expected = 16_000 / pool.length;
    const tolerance = expected * 0.1;
    for (const id of pool) {
      expect(Math.abs((firstCounts.get(id) ?? 0) - expected)).toBeLessThan(tolerance);
    }
  });

  it("consecutive-repeat rate matches the 1/N expectation for a uniform picker", () => {
    // This directly addresses the perception "the same person gets picked
    // again and again". With a uniform RNG and pool of N=10, the probability
    // that two consecutive picks are identical is exactly 1/N. The tolerance
    // band catches both pathologies:
    //   - Sticky picker  → repeats >> draws/N  → fails high.
    //   - Round-robin    → repeats << draws/N  → fails low.
    // When the anti-recency feature lands, this expectation flips and this
    // test should be replaced, not loosened.
    const pool = Array.from({ length: 10 }, (_, i) => `U${i}`);
    const rng = mulberry32(0xfacefeed);
    const draws = 50_000;
    let last: string | undefined;
    let repeats = 0;

    for (let i = 0; i < draws; i++) {
      const result = pick(rng, pool, 1);
      const curr = result[0] as string;
      if (last !== undefined && curr === last) repeats++;
      last = curr;
    }

    const expectedRepeats = (draws - 1) / pool.length;
    const tolerance = expectedRepeats * 0.1;
    expect(Math.abs(repeats - expectedRepeats)).toBeLessThan(tolerance);
  });

  it("seeds that differ by one bit produce visibly different orderings (RNG avalanche sanity)", () => {
    // Not a uniformity test per se, but a cheap check that a one-bit seed
    // change perturbs the whole output sequence, not just the first draw. If
    // someone swapped mulberry32 for a broken `() => seed % N` style RNG, this
    // would fall over even though raw uniformity might still look fine.
    const pool = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    const a = pick(mulberry32(0b1000_0000), pool, 10);
    const b = pick(mulberry32(0b1000_0001), pool, 10);
    let differingPositions = 0;
    for (let i = 0; i < pool.length; i++) {
      if (a[i] !== b[i]) differingPositions++;
    }
    expect(differingPositions).toBeGreaterThanOrEqual(pool.length / 2);
  });
});
