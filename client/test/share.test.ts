import type { Graph } from "@nodestorm/shared";
import { deflateSync } from "fflate";
import { describe, expect, it } from "vitest";
import { decodeShare, encodeShare, shareToken, shareUrl, ShareError, toBase64Url } from "../src/lib/share";

const node = (id: string, name: string, extra: Partial<Graph["nodes"][number]> = {}): Graph["nodes"][number] => ({
  id,
  name,
  definition: "",
  aliases: [],
  status: "ok",
  position: { x: 0, y: 0 },
  dependsOn: [],
  missingDeps: [],
  ...extra,
});

const graph: Graph = {
  id: "g1",
  name: "Main",
  nodes: [
    node("n-group", "Group", { definition: "A set with an associative operation…", aliases: ["群"], position: { x: 10.4, y: -20.6 } }),
    node("n-hom", "Homomorphism 同态 🚀", { definition: "Structure-preserving map ✨", dependsOn: ["n-group"] }),
    node("n-iso", "First Isomorphism Theorem", {
      status: "blocked",
      dependsOn: ["n-hom"],
      missingDeps: [{ name: "Isomorphism", reason: "derives an isomorphism", role: "derives" }],
    }),
  ],
  relations: [
    { id: "r1", a: "n-group", b: "n-hom", aToB: { kind: "is domain of", explanation: "" }, bToA: { kind: "preserves", explanation: "keeps 乘法" }, origin: "mix" },
    { id: "r2", a: "n-hom", b: "n-iso", aToB: { kind: "used by", explanation: "" }, bToA: { kind: "uses", explanation: "" }, origin: "dependency" },
  ],
};

/** The graph with ids replaced by names, so graphs can be compared across the (id-renaming) round trip. */
function byName(g: Graph) {
  const name = (id: string) => g.nodes.find((n) => n.id === id)?.name;
  return {
    name: g.name,
    nodes: g.nodes.map(({ id: _id, dependsOn, ...n }) => ({ ...n, dependsOn: dependsOn.map(name) })),
    relations: g.relations.map(({ id: _id, a, b, ...r }) => ({ ...r, a: name(a), b: name(b) })),
  };
}

describe("share links", () => {
  for (const native of [true, false]) {
    it(`round-trips a graph, including Chinese and emoji (${native ? "CompressionStream" : "fflate"})`, async () => {
      const token = await encodeShare(graph, "代数 brainstorm 🧠", { native });
      expect(token).toMatch(/^1\.[A-Za-z0-9_-]+$/);
      // Either implementation can read what the other wrote.
      const out = await decodeShare(token, { native: !native });
      expect(out.name).toBe("代数 brainstorm 🧠");
      expect(out.fixes).toEqual([]);
      const expected = byName(graph);
      expected.nodes[0].position = { x: 10, y: -21 }; // positions are rounded
      expect(byName(out.graph)).toEqual(expected);
    });
  }

  it("settles running and failed checks and drops error text", async () => {
    const g: Graph = {
      ...graph,
      nodes: [
        node("a", "A", { status: "checking" }),
        node("b", "B", { status: "error", error: "timeout", missingDeps: [{ name: "C", reason: "", role: "uses" }] }),
      ],
      relations: [],
    };
    const out = await decodeShare(await encodeShare(g, "x"));
    // Without a definition or missing prerequisites, the interrupted concept still needs a definition.
    expect(out.graph.nodes.map((n) => [n.status, n.error])).toEqual([["unclear", undefined], ["blocked", undefined]]);
  });

  it("shares a sandbox as a standalone graph", async () => {
    const out = await decodeShare(await encodeShare({ ...graph, name: "Sandbox 2", parentId: "g0", forkedAt: 1 }, "P"));
    expect(out.graph.parentId).toBeUndefined();
    expect(out.graph.name).toBe("Main");
  });

  it("is much shorter than the plain JSON", async () => {
    const big: Graph = {
      ...graph,
      nodes: Array.from({ length: 60 }, (_, i) => node(`node-${i}`, `Concept ${i}`, { definition: "Some definition text ".repeat(4) })),
      relations: [],
    };
    const token = await encodeShare(big, "Big");
    expect(token.length).toBeLessThan(JSON.stringify(big).length / 4);
  });

  it("rejects corrupt, truncated and foreign tokens with a friendly error", async () => {
    const token = await encodeShare(graph, "P");
    const bad = [
      "",
      "garbage",
      "1.",
      "1.!!!notbase64",
      "1.A",
      token.slice(0, Math.floor(token.length / 2)),
      `1.${toBase64Url(deflateSync(new TextEncoder().encode("not json")))}`,
      `1.${toBase64Url(deflateSync(new TextEncoder().encode('{"hello":"world"}')))}`,
      `1.${toBase64Url(new Uint8Array([0xff, 0xfe, 0x00, 0x12]))}`,
    ];
    for (const native of [true, false]) {
      for (const t of bad) {
        const err = await decodeShare(t, { native }).catch((e) => e);
        expect(err, `${t} (${native})`).toBeInstanceOf(ShareError);
      }
    }
    await expect(decodeShare("9.abc")).rejects.toThrow(/newer version/);
  });

  it("caps the decompressed size (zip bomb)", async () => {
    // 20 MB of spaces compresses to ~20 KB.
    const bomb = `1.${toBase64Url(deflateSync(new Uint8Array(20 * 1024 * 1024).fill(32), { level: 9 }))}`;
    expect(bomb.length).toBeLessThan(100_000);
    for (const native of [true, false]) {
      await expect(decodeShare(bomb, { native })).rejects.toThrow(/more data/);
    }
    // A normal link stays under a small cap too.
    await expect(decodeShare(await encodeShare(graph, "P"), { maxBytes: 10 })).rejects.toThrow(ShareError);
  });

  it("refuses oversized tokens before decoding", async () => {
    await expect(decodeShare(`1.${"A".repeat(600_000)}`)).rejects.toThrow(/too large/);
  });

  it("builds and parses the hash", () => {
    const url = shareUrl("1.abc", { origin: "https://x.github.io", pathname: "/nodestorm/", search: "" });
    expect(url).toBe("https://x.github.io/nodestorm/#share=1.abc");
    expect(shareToken(new URL(url).hash)).toBe("1.abc");
    expect(shareToken("#other")).toBeNull();
  });
});
