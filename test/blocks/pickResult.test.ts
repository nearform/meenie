import { describe, expect, it } from "vitest";
import {
  decodeScope,
  encodeScope,
  pickResultBlocks,
} from "../../src/blocks/pickResult.ts";
import type { Scope } from "../../src/types.ts";

describe("encodeScope / decodeScope", () => {
  it("round-trips a channel scope", () => {
    const scope: Scope = { type: "channel", id: "C12345" };
    expect(decodeScope(encodeScope(scope))).toEqual(scope);
  });

  it("round-trips a list scope", () => {
    const scope: Scope = { type: "list", id: "my-team" };
    expect(decodeScope(encodeScope(scope))).toEqual(scope);
  });

  it("returns null on undefined input", () => {
    expect(decodeScope(undefined)).toBeNull();
  });

  it("returns null on the empty string", () => {
    expect(decodeScope("")).toBeNull();
  });

  it("returns null when there is no `:` separator", () => {
    expect(decodeScope("channel")).toBeNull();
  });

  it("returns null when the type is empty (`:foo`)", () => {
    expect(decodeScope(":foo")).toBeNull();
  });

  it("returns null on unknown types (`bogus:x`)", () => {
    expect(decodeScope("bogus:x")).toBeNull();
  });

  it("returns null when the id is empty (`channel:`)", () => {
    expect(decodeScope("channel:")).toBeNull();
  });
});

describe("pickResultBlocks", () => {
  it("includes a pick_again button whose value is encodeScope(scope)", () => {
    const scope: Scope = { type: "channel", id: "C42" };
    const { blocks } = pickResultBlocks({
      scope,
      pickedUserIds: ["U1"],
      total: 5,
    });
    const actionsBlock = blocks.find((b) => b.type === "actions");
    expect(actionsBlock).toBeDefined();
    type ActionsBlock = { type: "actions"; elements: ReadonlyArray<{ type: string; action_id?: string; value?: string }> };
    const button = (actionsBlock as ActionsBlock).elements.find(
      (el) => el.type === "button" && el.action_id === "pick_again",
    );
    expect(button).toBeDefined();
    expect(button?.value).toBe(encodeScope(scope));
  });

  it("text fallback mentions every picked user", () => {
    const scope: Scope = { type: "list", id: "team" };
    const { text } = pickResultBlocks({
      scope,
      pickedUserIds: ["U1", "U2", "U3"],
      total: 3,
    });
    expect(text).toContain("<@U1>");
    expect(text).toContain("<@U2>");
    expect(text).toContain("<@U3>");
  });

  it("singular `is up` for a single pick, plural `are up` for many", () => {
    const scope: Scope = { type: "channel", id: "C1" };
    const single = pickResultBlocks({
      scope,
      pickedUserIds: ["U1"],
      total: 5,
    });
    const many = pickResultBlocks({
      scope,
      pickedUserIds: ["U1", "U2"],
      total: 5,
    });
    type SectionBlock = { type: "section"; text: { text: string } };
    const singleHeader = (single.blocks[0] as SectionBlock).text.text;
    const manyHeader = (many.blocks[0] as SectionBlock).text.text;
    expect(singleHeader).toContain("is up");
    expect(manyHeader).toContain("are up");
  });

  it("renders an empty-pick message when no one was picked", () => {
    const scope: Scope = { type: "list", id: "team" };
    const { text } = pickResultBlocks({
      scope,
      pickedUserIds: [],
      total: 0,
    });
    expect(text).toContain("No members to pick from");
    expect(text).toContain("team");
  });
});
