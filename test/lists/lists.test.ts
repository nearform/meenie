import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn<(text: string, params?: readonly unknown[]) => Promise<unknown[]>>();
const queryOne = vi.fn<(text: string, params?: readonly unknown[]) => Promise<unknown | null>>();
const withTransaction = vi.fn();

vi.mock("../../src/db.ts", () => ({
  query,
  queryOne,
  withTransaction,
  pool: {},
}));

const {
  createList,
  deleteList,
  addMember,
  removeMember,
  showList,
  resolveListMembers,
  listAllLists,
  ListNotFoundError,
  ListAlreadyExistsError,
} = await import("../../src/lists/index.ts");

class PgError extends Error {
  code: string;
  constructor(code: string, message = "pg error") {
    super(message);
    this.code = code;
  }
}

describe("lists service", () => {
  beforeEach(() => {
    query.mockReset();
    queryOne.mockReset();
    withTransaction.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("createList", () => {
    it("returns { id, name } with the lowercased name on success", async () => {
      queryOne.mockResolvedValueOnce({ id: "42", name: "engineering" });
      const result = await createList("T1", "Engineering");
      expect(result).toEqual({ id: "42", name: "engineering" });
      const params = queryOne.mock.calls[0]?.[1];
      expect(params).toEqual(["T1", "engineering"]);
    });

    it("throws ListAlreadyExistsError on PG unique violation (23505)", async () => {
      queryOne.mockRejectedValueOnce(new PgError("23505"));
      await expect(createList("T1", "Engineering")).rejects.toBeInstanceOf(
        ListAlreadyExistsError,
      );
    });

    it("preserves the lowercased name on ListAlreadyExistsError", async () => {
      queryOne.mockRejectedValueOnce(new PgError("23505"));
      try {
        await createList("T1", "FooBar");
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ListAlreadyExistsError);
        expect((err as InstanceType<typeof ListAlreadyExistsError>).listName).toBe(
          "foobar",
        );
      }
    });

    it("rethrows unrelated DB errors verbatim", async () => {
      const boom = new PgError("08006", "connection terminated");
      queryOne.mockRejectedValueOnce(boom);
      await expect(createList("T1", "foo")).rejects.toBe(boom);
    });
  });

  describe("deleteList", () => {
    it("returns true when a row was deleted", async () => {
      query.mockResolvedValueOnce([{ id: "1" }]);
      await expect(deleteList("T1", "Foo")).resolves.toBe(true);
      expect(query.mock.calls[0]?.[1]).toEqual(["T1", "foo"]);
    });

    it("returns false when no row matched", async () => {
      query.mockResolvedValueOnce([]);
      await expect(deleteList("T1", "ghost")).resolves.toBe(false);
    });
  });

  describe("addMember", () => {
    it("throws ListNotFoundError when the list does not exist", async () => {
      queryOne.mockResolvedValueOnce(null);
      await expect(addMember("T1", "ghost", "U1")).rejects.toBeInstanceOf(
        ListNotFoundError,
      );
    });

    it("uses ON CONFLICT DO NOTHING so adds are idempotent", async () => {
      queryOne.mockResolvedValueOnce({ id: "9" });
      query.mockResolvedValueOnce([]);
      await addMember("T1", "team", "U1");
      const sql = query.mock.calls[0]?.[0] as string;
      expect(sql).toMatch(/INSERT INTO list_members/);
      expect(sql).toMatch(/ON CONFLICT DO NOTHING/i);
      expect(query.mock.calls[0]?.[1]).toEqual(["9", "U1"]);
    });
  });

  describe("removeMember", () => {
    it("throws ListNotFoundError when the list does not exist", async () => {
      queryOne.mockResolvedValueOnce(null);
      await expect(removeMember("T1", "ghost", "U1")).rejects.toBeInstanceOf(
        ListNotFoundError,
      );
    });

    it("returns true when a member row was deleted", async () => {
      queryOne.mockResolvedValueOnce({ id: "9" });
      query.mockResolvedValueOnce([{ slack_user_id: "U1" }]);
      await expect(removeMember("T1", "team", "U1")).resolves.toBe(true);
    });

    it("returns false when no row was deleted", async () => {
      queryOne.mockResolvedValueOnce({ id: "9" });
      query.mockResolvedValueOnce([]);
      await expect(removeMember("T1", "team", "U-missing")).resolves.toBe(false);
    });
  });

  describe("showList", () => {
    it("returns null when the list does not exist", async () => {
      queryOne.mockResolvedValueOnce(null);
      await expect(showList("T1", "ghost")).resolves.toBeNull();
    });

    it("returns the list with its member ids", async () => {
      queryOne.mockResolvedValueOnce({ id: "1", name: "team" });
      query.mockResolvedValueOnce([
        { slack_user_id: "U1" },
        { slack_user_id: "U2" },
      ]);
      const result = await showList("T1", "team");
      expect(result).toEqual({
        id: "1",
        name: "team",
        memberIds: ["U1", "U2"],
      });
    });
  });

  describe("resolveListMembers", () => {
    it("returns [] for an existing-but-empty list", async () => {
      queryOne.mockResolvedValueOnce({ id: "1" });
      query.mockResolvedValueOnce([]);
      await expect(resolveListMembers("T1", "team")).resolves.toEqual([]);
    });

    it("throws ListNotFoundError when the list does not exist", async () => {
      queryOne.mockResolvedValueOnce(null);
      await expect(resolveListMembers("T1", "ghost")).rejects.toBeInstanceOf(
        ListNotFoundError,
      );
    });

    it("returns slack user ids in DB order", async () => {
      queryOne.mockResolvedValueOnce({ id: "1" });
      query.mockResolvedValueOnce([
        { slack_user_id: "U1" },
        { slack_user_id: "U2" },
        { slack_user_id: "U3" },
      ]);
      await expect(resolveListMembers("T1", "team")).resolves.toEqual([
        "U1",
        "U2",
        "U3",
      ]);
    });
  });

  describe("listAllLists", () => {
    it("parses member_count text into a number", async () => {
      query.mockResolvedValueOnce([
        { id: "1", name: "alpha", member_count: "0" },
        { id: "2", name: "beta", member_count: "3" },
      ]);
      await expect(listAllLists("T1")).resolves.toEqual([
        { id: "1", name: "alpha", memberCount: 0 },
        { id: "2", name: "beta", memberCount: 3 },
      ]);
    });
  });
});
