import { describe, expect, it, vi } from "vitest";

// `src/handlers/pick.ts` has top-of-module side effects (it calls
// `registerSubcommand("pick", ...)` and `boltApp.action("pick_again", ...)`),
// so we mock the slack/router/picker/stats modules it transitively imports
// before pulling it in. The unit under test (`parsePickTarget`) is a pure
// function and exercising it doesn't need any of those runtime collaborators.
vi.mock("../../src/slack.ts", () => ({
  boltApp: { command: vi.fn(), action: vi.fn() },
  getClientForTeam: vi.fn(),
}));

vi.mock("../../src/router.ts", () => ({
  registerSubcommand: vi.fn(),
  listSubcommands: () => [],
}));

vi.mock("../../src/picker/index.ts", () => ({
  pick: vi.fn(),
  pickFromChannel: vi.fn(),
  pickFromList: vi.fn(),
}));

vi.mock("../../src/stats/index.ts", () => ({
  recordPick: vi.fn(),
  recordPicks: vi.fn(),
  getStats: vi.fn(),
}));

const { parsePickTarget } = await import("../../src/handlers/pick.ts");

const FALLBACK = "C_FALLBACK";

describe("parsePickTarget", () => {
  describe("channel forms", () => {
    it("parses Slack mention syntax `<#C12345|name>`", () => {
      expect(parsePickTarget("<#C12345|general>", FALLBACK)).toEqual({
        type: "channel",
        id: "C12345",
      });
    });

    it("parses Slack mention syntax without the |name suffix", () => {
      expect(parsePickTarget("<#C12345>", FALLBACK)).toEqual({
        type: "channel",
        id: "C12345",
      });
    });

    it("parses bare uppercase channel ids `C12345`", () => {
      expect(parsePickTarget("C12345", FALLBACK)).toEqual({
        type: "channel",
        id: "C12345",
      });
    });

    it("uppercases bare channel ids that arrived lowercase", () => {
      expect(parsePickTarget("c12345", FALLBACK)).toEqual({
        type: "channel",
        id: "C12345",
      });
    });

    it("accepts DM ids (D...) and groups (G...)", () => {
      expect(parsePickTarget("D9999", FALLBACK)).toEqual({
        type: "channel",
        id: "D9999",
      });
      expect(parsePickTarget("G9999", FALLBACK)).toEqual({
        type: "channel",
        id: "G9999",
      });
    });
  });

  describe("list forms", () => {
    it("parses `@listname` as a list", () => {
      expect(parsePickTarget("@my-team", FALLBACK)).toEqual({
        type: "list",
        id: "my-team",
      });
    });

    it("parses `:listname` as a list", () => {
      expect(parsePickTarget(":my-team", FALLBACK)).toEqual({
        type: "list",
        id: "my-team",
      });
    });

    it("parses bare snake_case list names", () => {
      expect(parsePickTarget("my_list", FALLBACK)).toEqual({
        type: "list",
        id: "my_list",
      });
    });

    it("lowercases list names", () => {
      expect(parsePickTarget("@Engineering", FALLBACK)).toEqual({
        type: "list",
        id: "engineering",
      });
    });

    it("accepts list names starting with a digit", () => {
      expect(parsePickTarget("9-team", FALLBACK)).toEqual({
        type: "list",
        id: "9-team",
      });
    });
  });

  describe("fallbacks", () => {
    it("falls back to the invocation channel when arg is undefined", () => {
      expect(parsePickTarget(undefined, FALLBACK)).toEqual({
        type: "channel",
        id: FALLBACK,
      });
    });

    it("falls back to the invocation channel when arg is empty", () => {
      expect(parsePickTarget("", FALLBACK)).toEqual({
        type: "channel",
        id: FALLBACK,
      });
    });

    it("falls back on gibberish input (`!!!`)", () => {
      expect(parsePickTarget("!!!", FALLBACK)).toEqual({
        type: "channel",
        id: FALLBACK,
      });
    });

    it("falls back when the list-name regex rejects (e.g. spaces)", () => {
      expect(parsePickTarget("Team Name with spaces", FALLBACK)).toEqual({
        type: "channel",
        id: FALLBACK,
      });
    });

    it("falls back for names starting with a non-alphanumeric character", () => {
      expect(parsePickTarget("-team", FALLBACK)).toEqual({
        type: "channel",
        id: FALLBACK,
      });
    });

    it("falls back for names that exceed the 32-char limit", () => {
      const tooLong = `${"a".repeat(33)}`;
      expect(parsePickTarget(tooLong, FALLBACK)).toEqual({
        type: "channel",
        id: FALLBACK,
      });
    });
  });
});
