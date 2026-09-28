import {
  AbsurdChainRequest,
  BRIEF_LIST_MAX,
  DeriveRequest,
  ExplainRequest,
  HINT_MAX,
  NAME_MAX,
  NameRequest,
  PROBLEMS_MAX_PAGES,
  ResolveCycleRequest,
  SplitProblemsRequest,
  type Graph,
} from "@nodestorm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { absurdChain, derive, explainNode, resolveCycle, suggestNames } from "../src/lib/actions";
import { api } from "../src/lib/api";
import * as ops from "../src/lib/graphOps";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// What the user types or the graph holds is cut to the request schemas' caps before it is sent, so a long description,
// goal or name never makes the AI call fail with a validation error.

vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
});

const store = () => useGraphStore.getState();
const graph = (): Graph => store().graphs[store().activeId];
const byName = (name: string) => graph().nodes.find((n) => n.name === name)!;
const LONG = "a long name ".repeat(100).trim();

beforeEach(() => {
  store().reset();
  store().setToast(null);
  useSettings.setState({ connection: "browser", provider: "mock" });
  store().mutate((g) => {
    const a = ops.addNode(g, { name: "Group", definition: "A set with an operation." });
    const b = ops.addNode(a.graph, { name: LONG, definition: "Very long." });
    return ops.upsertRelation(b.graph, a.id, b.id, { kind: "uses", explanation: "r".repeat(10_000) }, { kind: "used by", explanation: "y" });
  });
});

afterEach(() => vi.restoreAllMocks());

describe("requests within their caps", () => {
  it("a long description and goal are trimmed and cut", async () => {
    const name = vi.spyOn(api, "name").mockResolvedValue({ candidates: [] } as never);
    const der = vi.spyOn(api, "derive").mockResolvedValue({ proposals: [] });
    await suggestNames(`  ${"d".repeat(HINT_MAX * 2)}  `);
    await derive([byName("Group").id], `  ${"g".repeat(HINT_MAX * 2)}  `);
    const nameReq = name.mock.calls[0][0];
    expect(nameReq.description.length).toBeLessThanOrEqual(HINT_MAX);
    expect(nameReq.description.startsWith("d")).toBe(true);
    expect(NameRequest.safeParse(nameReq).success).toBe(true);
    expect(DeriveRequest.safeParse(der.mock.calls[0][0]).success).toBe(true);
    await derive([byName("Group").id], "   ");
    expect(der.mock.calls[1][0].goal).toBeUndefined();
  });

  it("the schemas refuse an over-long description or goal", () => {
    expect(NameRequest.safeParse({ description: "d".repeat(HINT_MAX + 1) }).success).toBe(false);
    expect(DeriveRequest.safeParse({ selected: [{ name: "X" }], goal: "g".repeat(HINT_MAX + 1) }).success).toBe(false);
  });

  it("explaining a concept related to one with a very long name", async () => {
    const explain = vi.spyOn(api, "explain").mockRejectedValue(new Error("stop"));
    await explainNode(byName("Group").id, "intuitive");
    expect(ExplainRequest.safeParse(explain.mock.calls[0][0]).success).toBe(true);
  });

  it("a cycle link's long reason", async () => {
    const res = vi.spyOn(api, "resolveCycle").mockRejectedValue(new Error("stop"));
    const [a, b] = [byName("Group").id, byName(LONG).id];
    store().mutate((g) => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === a ? { ...n, dependsOn: [b] } : n.id === b ? { ...n, dependsOn: [a] } : n)),
    }));
    await resolveCycle(graph().id, [a, b, a], { silent: true });
    expect(res).toHaveBeenCalled();
    expect(ResolveCycleRequest.safeParse(res.mock.calls[0][0]).success).toBe(true);
  });

  it("'Roll again' after many rolls sends only the latest concepts to avoid", async () => {
    const chain = vi.spyOn(api, "absurdChain").mockRejectedValue(new Error("stop"));
    const avoid = Array.from({ length: 100 }, (_, i) => `Stop ${i} ${"x".repeat(i === 99 ? 500 : 0)}`);
    await absurdChain("Group", "Ring", "deadpan", { min: 3, max: 5 }, avoid);
    const req = chain.mock.calls[0][0];
    expect(AbsurdChainRequest.safeParse(req).success).toBe(true);
    expect(req.avoid).toContain("Stop 98 ");
  });
});

describe("request schemas without unbounded lists", () => {
  it("a problem sheet request takes at most PROBLEMS_MAX_PAGES pages", () => {
    const pages = (n: number) => Array.from({ length: n }, (_, i) => ({ page: i + 1, text: "x" }));
    expect(SplitProblemsRequest.safeParse({ pages: pages(PROBLEMS_MAX_PAGES) }).success).toBe(true);
    expect(SplitProblemsRequest.safeParse({ pages: pages(PROBLEMS_MAX_PAGES + 1) }).success).toBe(false);
  });

  it("an explanation's relations and a cycle link's reason are capped", () => {
    const rel = { other: "X", toOther: { kind: "uses", explanation: "" }, fromOther: { kind: "used by", explanation: "" } };
    const explain = (relations: unknown[]) => ExplainRequest.safeParse({ node: { name: "A" }, relations }).success;
    expect(explain([rel])).toBe(true);
    expect(explain([{ ...rel, other: "x".repeat(NAME_MAX + 1) }])).toBe(false);
    expect(explain(Array(BRIEF_LIST_MAX + 1).fill(rel))).toBe(false);
    const link = { from: { name: "A" }, to: { name: "B" }, reason: "r".repeat(HINT_MAX + 1) };
    expect(ResolveCycleRequest.safeParse({ links: [link, link] }).success).toBe(false);
  });
});
