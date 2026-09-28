import type { Graph } from "@nodestorm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocale } from "../src/i18n";
import { addConcept, analyzeNode } from "../src/lib/actions";
import * as ops from "../src/lib/graphOps";
import { repairImport } from "../src/lib/importRepair";
import { useGraphStore } from "../src/store/graphStore";
import { useSettings } from "../src/store/settingsStore";

// Regressions for the second post-merge review; drives the real store + actions with the mock AI.

vi.hoisted(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
});

const store = () => useGraphStore.getState();
const settle = () => new Promise((r) => setTimeout(r, 20));
const idle = async () => {
  for (let i = 0; i < 100 && Object.keys(store().busy).length; i++) await settle();
};
const nodeIn = (graphId: string, name: string) => store().graphs[graphId]?.nodes.find((n) => n.name === name);

beforeEach(() => {
  store().reset();
  useSettings.setState({ connection: "browser", provider: "mock", clarify: { enabled: true, options: 3 } });
  useLocale.getState().setPref("en");
});
afterEach(() => useLocale.getState().setPref("en"));

describe("share viewer and your own work", () => {
  it("opening a shared graph doesn't stop AI work on your own graph", async () => {
    const own = store().activeId;
    addConcept({ name: "Kernel", definition: "set sent to the identity" });
    store().openView(ops.emptyGraph("Shared"), "Shared"); // while the check is running
    await idle();
    expect(nodeIn(own, "Kernel")!.status).not.toBe("error");
    // …and a check started now for your own graph still runs.
    void analyzeNode(nodeIn(own, "Kernel")!.id, own);
    await idle();
    expect(nodeIn(own, "Kernel")!.status).toBe("blocked"); // mock: Kernel needs Homomorphism
  });

  it("AI actions on the shared graph itself are refused", async () => {
    const shared: Graph = { ...ops.emptyGraph("Shared"), nodes: [] };
    const withNode = ops.addNode(shared, { name: "Group", definition: "d" });
    store().openView(ops.applyDeps(withNode.graph, withNode.id, []), "Shared");
    const viewId = store().activeId;
    const node = store().graphs[viewId].nodes[0];
    await analyzeNode(node.id, viewId);
    expect(Object.keys(store().busy)).toHaveLength(0);
    expect(store().graphs[viewId].nodes[0].status).toBe("ok");
  });
});

describe("duplicating a project mid-check", () => {
  it("the copy doesn't wait forever for a check it will never get", async () => {
    addConcept({ name: "Group" }); // check running
    store().duplicateProject(store().projectId);
    await idle();
    // Both projects have the concept (so the loop below isn't vacuous), and neither waits on a check.
    const withGroup = Object.values(store().graphs).filter((g) => g.nodes.some((n) => n.name === "Group"));
    expect(withGroup).toHaveLength(2);
    for (const g of withGroup) expect(g.nodes.map((n) => n.status)).not.toContain("checking");
  });
});

describe("import repair messages follow the interface language", () => {
  it("in Chinese", () => {
    useLocale.getState().setPref("zh");
    const { fixes, doc } = repairImport({
      format: "nodestorm/v1",
      graphs: [{ id: "g1", nodes: [{ id: "n1", name: "Group", status: "checking" }], relations: [] }],
    });
    expect(fixes.join(" ")).toContain("为没有位置的概念安排了位置");
    expect(doc.graphs[0].nodes[0].error).toContain("导出时检查尚未完成");
  });
});
