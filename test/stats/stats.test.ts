import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn<(text: string, params?: readonly unknown[]) => Promise<unknown[]>>();
const queryOne = vi.fn<(text: string, params?: readonly unknown[]) => Promise<unknown | null>>();
const withTransaction = vi.fn<(fn: (client: unknown) => Promise<unknown>) => Promise<unknown>>();

vi.mock("../../src/db.ts", () => ({
  query,
  queryOne,
  withTransaction,
  pool: {},
}));

const { recordPick, recordPicks, getStats } = await import(
  "../../src/stats/index.ts"
);

describe("stats service", () => {
  beforeEach(() => {
    query.mockReset();
    queryOne.mockReset();
    withTransaction.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("recordPick", () => {
    it("logs and swallows DB errors instead of throwing", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      query.mockRejectedValueOnce(new Error("db down"));
      await expect(
        recordPick("T1", { type: "channel", id: "C1" }, "U1"),
      ).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledWith("recordPick failed", expect.any(Object));
    });

    it("inserts one row on the happy path", async () => {
      query.mockResolvedValueOnce([]);
      await recordPick("T1", { type: "list", id: "team" }, "U1");
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/INSERT INTO picks/);
      expect(params).toEqual(["T1", "list", "team", "U1"]);
    });
  });

  describe("recordPicks", () => {
    it("short-circuits and skips the transaction when pickedUserIds is empty", async () => {
      await recordPicks("T1", { type: "channel", id: "C1" }, []);
      expect(withTransaction).not.toHaveBeenCalled();
    });

    it("writes one row per user inside a single transaction", async () => {
      const clientQuery = vi.fn<
        (sql: string, params: readonly unknown[]) => Promise<{ rows: unknown[] }>
      >(async () => ({ rows: [] }));
      withTransaction.mockImplementationOnce(async (fn) =>
        fn({ query: clientQuery } as unknown as never),
      );
      await recordPicks(
        "T1",
        { type: "channel", id: "C1" },
        ["U1", "U2", "U3"],
      );
      expect(withTransaction).toHaveBeenCalledTimes(1);
      expect(clientQuery).toHaveBeenCalledTimes(3);
      const userIds = clientQuery.mock.calls.map((call) => call[1][3]);
      expect(userIds).toEqual(["U1", "U2", "U3"]);
    });

    it("logs and swallows transaction errors", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      withTransaction.mockRejectedValueOnce(new Error("rolled back"));
      await expect(
        recordPicks("T1", { type: "channel", id: "C1" }, ["U1"]),
      ).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledWith(
        "recordPicks failed",
        expect.any(Object),
      );
    });
  });

  describe("getStats", () => {
    it("returns lastPickedAt=null and an empty perMember when no picks recorded", async () => {
      queryOne.mockResolvedValueOnce({ total: "0", last_picked_at: null });
      const result = await getStats("T1", { type: "channel", id: "C1" });
      expect(result.totalPicks).toBe(0);
      expect(result.perMember).toEqual([]);
      expect(result.lastPickedAt).toBeNull();
      // Avoids a wasted GROUP BY round-trip when there are no rows.
      expect(query).not.toHaveBeenCalled();
    });

    it("returns lastPickedAt=null when summary row is missing entirely", async () => {
      queryOne.mockResolvedValueOnce(null);
      const result = await getStats("T1", { type: "channel", id: "C1" });
      expect(result.totalPicks).toBe(0);
      expect(result.perMember).toEqual([]);
      expect(result.lastPickedAt).toBeNull();
    });

    it("defaults windowDays to 30", async () => {
      queryOne.mockResolvedValueOnce({ total: "0", last_picked_at: null });
      const result = await getStats("T1", { type: "channel", id: "C1" });
      expect(result.windowDays).toBe(30);
      // The 4th query param is the window in days.
      expect(queryOne.mock.calls[0]?.[1]?.[3]).toBe(30);
    });

    it("honours an explicit windowDays argument", async () => {
      queryOne.mockResolvedValueOnce({ total: "0", last_picked_at: null });
      const result = await getStats(
        "T1",
        { type: "list", id: "team" },
        7,
      );
      expect(result.windowDays).toBe(7);
      expect(queryOne.mock.calls[0]?.[1]?.[3]).toBe(7);
    });

    it("returns perMember rows as provided by the SQL (trusting its ORDER BY)", async () => {
      const lastPickedAt = new Date("2026-05-01T12:34:56.000Z");
      queryOne.mockResolvedValueOnce({
        total: "5",
        last_picked_at: lastPickedAt,
      });
      query.mockResolvedValueOnce([
        { picked_user_id: "U_HEAVY", count: "3" },
        { picked_user_id: "U_LIGHT_A", count: "1" },
        { picked_user_id: "U_LIGHT_B", count: "1" },
      ]);
      const result = await getStats("T1", { type: "channel", id: "C1" });
      expect(result.totalPicks).toBe(5);
      expect(result.lastPickedAt).toBe("2026-05-01T12:34:56.000Z");
      expect(result.perMember).toEqual([
        { userId: "U_HEAVY", count: 3 },
        { userId: "U_LIGHT_A", count: 1 },
        { userId: "U_LIGHT_B", count: 1 },
      ]);
      const sql = query.mock.calls[0]?.[0] as string;
      // Verifies the contract that ordering happens in SQL (so handlers can
      // trust the rows are already sorted by count DESC, userId ASC).
      expect(sql).toMatch(/ORDER BY COUNT\(\*\) DESC, picked_user_id ASC/);
    });

    it("includes the scope predicate in both summary and per-member queries", async () => {
      queryOne.mockResolvedValueOnce({ total: "1", last_picked_at: new Date() });
      query.mockResolvedValueOnce([{ picked_user_id: "U1", count: "1" }]);
      await getStats("T1", { type: "list", id: "team" });
      const summarySql = queryOne.mock.calls[0]?.[0] as string;
      const perMemberSql = query.mock.calls[0]?.[0] as string;
      expect(summarySql).toMatch(/scope_type = \$2/);
      expect(summarySql).toMatch(/scope_id = \$3/);
      expect(perMemberSql).toMatch(/scope_type = \$2/);
      expect(perMemberSql).toMatch(/scope_id = \$3/);
    });
  });
});
