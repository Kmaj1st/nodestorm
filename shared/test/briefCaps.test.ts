import { describe, expect, it } from "vitest";
import {
  BRIEF_ALIASES_MAX,
  BRIEF_DEFINITION_MAX,
  BRIEF_LIST_MAX,
  clipText,
  DeriveRequest,
  DepsRequest,
  NAME_MAX,
  NodeBrief,
  toBrief,
  toBriefs,
} from "../src/model";

describe("concept briefs within their caps", () => {
  it("clipText marks a cut with an ellipsis and never splits a surrogate pair", () => {
    expect(clipText("short", 10)).toBe("short");
    expect(clipText("abcdefghij", 5)).toBe("abcd…");
    expect(clipText("abc def", 5)).toBe("abc…");
    const cut = clipText("ab😀cd", 4);
    expect(cut).toBe("ab…");
    expect(cut.length).toBeLessThanOrEqual(4);
  });

  it("toBrief clips a long name, definition and aliases so the schema accepts it", () => {
    const b = toBrief({ name: "N".repeat(1000), definition: "d".repeat(10_000), aliases: Array.from({ length: 40 }, () => "a".repeat(999)) });
    expect(b.name.length).toBe(NAME_MAX);
    expect(b.name.endsWith("…")).toBe(true);
    expect(b.definition.length).toBe(BRIEF_DEFINITION_MAX);
    expect(b.definition.endsWith("…")).toBe(true);
    expect(b.aliases).toHaveLength(BRIEF_ALIASES_MAX);
    expect(NodeBrief.safeParse(b).success).toBe(true);
    // Short ones go unchanged, and it stays safe to pass to Array.map (one parameter).
    const small = { name: "Group", definition: "A set with an operation.", aliases: ["group"] };
    expect([small, small].map(toBrief)).toEqual([small, small]);
  });

  it("toBriefs keeps a big graph with long definitions within the list caps and under 1 MB", () => {
    const nodes = Array.from({ length: 900 }, (_, i) => ({ name: `Concept ${i}`, definition: "群".repeat(4000), aliases: [] }));
    const list = toBriefs(nodes);
    expect(list).toHaveLength(BRIEF_LIST_MAX);
    const body = JSON.stringify({ node: toBrief(nodes[0]), existing: list });
    expect(new TextEncoder().encode(body).length).toBeLessThan(1_000_000);
    expect(DepsRequest.safeParse({ node: toBrief(nodes[0]), existing: list }).success).toBe(true);
    expect(DeriveRequest.safeParse({ selected: toBriefs(nodes.slice(0, 3)), context: list }).success).toBe(true);
    // A small list keeps its definitions whole; `max` limits the count.
    expect(toBriefs(nodes.slice(0, 2))[0].definition).toBe("群".repeat(4000));
    expect(toBriefs(nodes, 80)).toHaveLength(80);
  });

  it("the schemas refuse briefs over the caps", () => {
    expect(NodeBrief.safeParse({ name: "x".repeat(NAME_MAX + 1) }).success).toBe(false);
    expect(NodeBrief.safeParse({ name: "X", definition: "d".repeat(BRIEF_DEFINITION_MAX + 1) }).success).toBe(false);
    expect(NodeBrief.safeParse({ name: "X", aliases: Array(BRIEF_ALIASES_MAX + 1).fill("a") }).success).toBe(false);
    const many = Array.from({ length: BRIEF_LIST_MAX + 1 }, (_, i) => ({ name: `C${i}` }));
    expect(DepsRequest.safeParse({ node: { name: "X" }, existing: many }).success).toBe(false);
  });
});
