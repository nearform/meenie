import { afterEach, describe, expect, it, vi } from "vitest";

// Avoid pulling Bolt into the test runtime: the help block consults
// `listSubcommands()` from the router, so we just feed it a canned list.
const listSubcommands = vi.fn<() => readonly string[]>();
vi.mock("../../src/router.ts", () => ({
  listSubcommands,
  registerSubcommand: vi.fn(),
}));

const { helpBlocks } = await import("../../src/blocks/help.ts");

describe("helpBlocks", () => {
  afterEach(() => {
    listSubcommands.mockReset();
  });

  it("renders one bullet per registered subcommand", () => {
    listSubcommands.mockReturnValueOnce(["help", "list", "pick", "stats"]);
    const { text } = helpBlocks();
    const bulletLines = text
      .split("\n")
      .filter((line) => line.startsWith("/meeny "));
    expect(bulletLines.length).toBe(4);
  });

  it("text fallback contains the known syntax lines for pick/list/stats/help", () => {
    listSubcommands.mockReturnValueOnce(["help", "list", "pick", "stats"]);
    const { text } = helpBlocks();
    expect(text).toContain("/meeny pick [#channel | @list]");
    expect(text).toContain(
      "/meeny list <create|add|remove|show|delete> ...",
    );
    expect(text).toContain("/meeny stats [#channel | @list]");
    expect(text).toContain("/meeny help");
  });

  it("renders a placeholder when no subcommands are registered", () => {
    listSubcommands.mockReturnValueOnce([]);
    const { blocks } = helpBlocks();
    const section = blocks.find(
      (b) =>
        b.type === "section" &&
        "text" in b &&
        b.text?.type === "mrkdwn" &&
        b.text.text.includes("No subcommands"),
    );
    expect(section).toBeDefined();
  });

  it("includes a header, tagline section, bullets section, and automation context", () => {
    listSubcommands.mockReturnValueOnce(["help", "pick"]);
    const { blocks } = helpBlocks();
    const types = blocks.map((b) => b.type);
    expect(types).toEqual(["header", "section", "section", "context"]);
  });

  it("falls back to a generic usage line for unknown subcommand names", () => {
    listSubcommands.mockReturnValueOnce(["pick", "wibble"]);
    const { text } = helpBlocks();
    expect(text).toContain("/meeny wibble");
    expect(text).toContain("(no description)");
  });
});
