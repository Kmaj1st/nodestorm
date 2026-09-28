import { beforeEach, describe, expect, it, vi } from "vitest";
import { tidy } from "../src/lib/actions";
import * as ops from "../src/lib/graphOps";
import { useGraphStore } from "../src/store/graphStore";
import { goToConcept, hiddenIn, hideConcepts, hideOthers, useView, visibleNow } from "../src/store/viewStore";

// Hiding concepts by hand: a view choice kept for the browser tab, never an edit of the graph.

const session = vi.hoisted(() => {
  const mem = () => {
    const data = new Map<string, string>();
    return {
      data,
      broken: false,
      getItem(k: string) {
        if (this.broken) throw new Error("blocked");
        return data.get(k) ?? null;
      },
      setItem(k: string, v: string) {
        if (this.broken) throw new Error("blocked");
        data.set(k, v);
      },
      removeItem(k: string) {
        if (this.broken) throw new Error("blocked");
        data.delete(k);
      },
    };
  };
  const g = globalThis as { localStorage?: unknown; sessionStorage?: unknown; requestAnimationFrame?: unknown };
  g.localStorage = mem();
  const s = mem();
  s.data.set("nodestorm-hidden", "{not json"); // what the tab kept is garbled: nothing is hidden
  g.sessionStorage = s;
  g.requestAnimationFrame = () => 0;
  return s;
});

const store = () => useGraphStore.getState();
const hidden = () => hiddenIn(store().activeId)(useView.getState());

/** A – B – C in a row (B depends on A, C on B), active. Returns their ids. */
function setup() {
  store().reset();
  let g = ops.emptyGraph();
  const ids: string[] = [];
  for (const name of ["A", "B", "C"]) {
    const r = ops.addNode(g, { name, position: { x: ids.length * 500, y: 0 } });
    g = r.graph;
    ids.push(r.id);
  }
  g = ops.link(g, ids[1], ids[0], "uses", "r");
  g = ops.link(g, ids[2], ids[1], "uses", "r");
  const id = store().activeId;
  useGraphStore.setState({ graphs: { ...store().graphs, [id]: { ...g, id } } });
  return ids;
}

beforeEach(() => {
  session.broken = false;
  useView.getState().setHidden({});
  useView.getState().setFocus(null);
});

describe("hiding concepts", () => {
  it("starts with nothing hidden when the stored list is garbled", () => {
    expect(useView.getState().hidden).toEqual({});
  });

  it("takes them and their relations off the canvas, out of the selection and the inspector", () => {
    const [a, b, c] = setup();
    store().setSelection([a, b]);
    store().setInspect({ kind: "node", id: b });
    expect(hideConcepts([b])).toBe(1);
    expect(hidden()).toEqual([b]);
    expect(store().selection).toEqual([a]);
    expect(store().inspect).toBeNull();
    const v = visibleNow();
    expect([...v.nodes].sort()).toEqual([a, c].sort());
    expect(v.relations.size).toBe(0);
    // Not an edit: no undo step, the graph is the same.
    expect(store().history[store().activeId]?.past.length ?? 0).toBe(0);
    expect(hideConcepts([b, "nope"])).toBe(0); // already hidden, or not there
  });

  it("closes a relation of a hidden concept and ends focus mode centred on it", () => {
    const [a, b] = setup();
    const rel = store().graphs[store().activeId].relations.find((r) => r.a === a || r.b === a)!;
    store().setInspect({ kind: "edge", relationId: rel.id, dir: "aToB" });
    useView.getState().setFocus({ graphId: store().activeId, nodeId: a });
    hideConcepts([a]);
    expect(store().inspect).toBeNull();
    expect(useView.getState().focus).toBeNull();
    expect(hidden()).toEqual([a]);
    hideConcepts([b]);
    expect(hidden()).toEqual([a, b]);
  });

  it("hide others keeps just the selection", () => {
    const [a, b, c] = setup();
    store().setSelection([b]);
    expect(hideOthers()).toBe(2);
    expect([...hidden()].sort()).toEqual([a, c].sort());
    expect(store().toast).toContain("2 other concepts");
    store().setSelection([]);
    expect(hideOthers()).toBe(0);
  });

  it("says what was hidden for screen readers (hide others says it in its toast instead)", () => {
    const [a, b, c] = setup();
    useView.setState({ hiddenSaid: "" });
    hideConcepts([a]);
    expect(useView.getState().hiddenSaid).toBe("Hid A from the canvas. “Show all” in the canvas corner brings it back.");
    hideConcepts([b, c]);
    expect(useView.getState().hiddenSaid).toMatch(/^Hid 2 concepts from the canvas\./);
    useView.setState({ hiddenSaid: "" });
    useView.getState().setHidden({});
    store().setSelection([b]);
    hideOthers();
    expect(useView.getState().hiddenSaid).toBe("");
  });

  it("shows one again, or all", () => {
    const [a, b, c] = setup();
    hideConcepts([a, b, c]);
    useView.getState().show(store().activeId, [b]);
    expect(hidden()).toEqual([a, c]);
    useView.getState().show(store().activeId);
    expect(hidden()).toEqual([]);
    expect(useView.getState().hidden).toEqual({});
  });

  it("shows a concept again when something goes to it, selects it or opens it", () => {
    const [a, b, c] = setup();
    hideConcepts([a, b, c]);
    goToConcept(a); // Find, the glossary, the 3D view
    expect(hidden()).toEqual([b, c]);
    expect(visibleNow().nodes.has(a)).toBe(true);
    store().setInspect({ kind: "node", id: b }); // a link in the inspector
    expect(hidden()).toEqual([c]);
    store().setSelection([c]); // the walkthrough's "Show on canvas"
    expect(hidden()).toEqual([]);
  });

  it("forgets deleted concepts and discarded graphs, and keeps each graph's own", () => {
    const [a, b] = setup();
    const main = store().activeId;
    hideConcepts([a, b]);
    // Gone from the graph and from every undo snapshot: nothing can bring it back.
    store().mutate((g) => (g.nodes.some((n) => n.id === a) ? ops.removeNode(g, a) : g), main, { history: "background" });
    expect(hidden()).toEqual([b]);
    store().forkActive();
    const sandbox = store().activeId;
    expect(sandbox).not.toBe(main);
    expect(hidden()).toEqual([]); // hiding is per graph
    hideConcepts([b]);
    store().discardSandbox(sandbox);
    expect(useView.getState().hidden).toEqual({ [main]: [b] });
  });

  it("a deleted hidden concept comes back hidden on Undo, and goes again on Redo", () => {
    const [a, b, c] = setup();
    hideConcepts([b]);
    store().mutate((g) => ops.removeNode(g, b));
    expect(visibleNow().nodes.has(b)).toBe(false);
    store().undo();
    expect(store().graphs[store().activeId].nodes.some((n) => n.id === b)).toBe(true);
    expect(hidden()).toEqual([b]);
    expect([...visibleNow().nodes].sort()).toEqual([a, c].sort());
    store().redo();
    expect(store().graphs[store().activeId].nodes.some((n) => n.id === b)).toBe(false);
    store().undo(); // still hidden after a round trip
    expect(hidden()).toEqual([b]);
    // A new step after the delete keeps it in the undo history, so it is still remembered…
    store().redo();
    store().mutate((g) => ops.updateNode(g, a, { notes: "x" }));
    store().undo();
    store().undo();
    expect(hidden()).toEqual([b]);
    expect(visibleNow().nodes.has(b)).toBe(false);
  });

  it("forgets a deleted hidden concept once no undo snapshot has it", () => {
    const [, b] = setup();
    hideConcepts([b]);
    store().mutate((g) => ops.removeNode(g, b));
    expect(hidden()).toEqual([b]); // Undo could bring it back
    const id = store().activeId;
    useGraphStore.setState({ history: { ...store().history, [id]: { past: [], future: [], lastKey: null } } });
    expect(hidden()).toEqual([]);
  });

  it("is kept for the tab session, and still works when storage is blocked", () => {
    const [a] = setup();
    hideConcepts([a]);
    expect(JSON.parse(session.data.get("nodestorm-hidden")!)).toEqual({ [store().activeId]: [a] });
    useView.getState().show(store().activeId);
    expect(session.data.has("nodestorm-hidden")).toBe(false);
    session.broken = true;
    expect(() => hideConcepts([a])).not.toThrow();
    expect(hidden()).toEqual([a]);
  });

  it("Tidy lays out what is shown and leaves hidden concepts where they are", () => {
    const [a, b, c] = setup();
    const at = (id: string) => store().graphs[store().activeId].nodes.find((n) => n.id === id)!.position;
    const before = at(c);
    hideConcepts([c]);
    tidy();
    expect(at(c)).toEqual(before);
    expect(at(a)).not.toEqual(at(b));
  });
});
