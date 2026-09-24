import {
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type NodeChange,
  type OnSelectionChangeParams,
  type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NODE_SIZE, updateNode } from "../lib/graphOps";
import { cycleInfo, linkKey, prerequisiteClosure } from "../lib/paths";
import { useTheme } from "../lib/theme";
import { MAX_HOPS, showsEverything, visibleParts } from "../lib/view";
import { registerViewport, viewport } from "../lib/viewport";
import { ShortcutsButton } from "../panels/ShortcutsHelp";
import { activeGraph, useGraphStore } from "../store/graphStore";
import { activeFocus, useView } from "../store/viewStore";
import { BiRelationEdge, type RelationFlowEdge } from "./BiRelationEdge";
import { ConceptNode, type ConceptFlowNode } from "./ConceptNode";

const nodeTypes = { concept: ConceptNode };
const edgeTypes = { bi: BiRelationEdge };

/** From this many concepts on, only what is on screen is rendered (React Flow's onlyRenderVisibleElements). */
const LARGE_GRAPH = 150;

export function GraphCanvas() {
  const graph = useGraphStore(activeGraph);
  const mutate = useGraphStore((s) => s.mutate);
  const setSelection = useGraphStore((s) => s.setSelection);
  const setInspect = useGraphStore((s) => s.setInspect);
  const theme = useTheme((s) => s.theme);
  const loadExample = useCallback(() => {
    useGraphStore.getState().loadExample();
    viewport.fit();
  }, []);

  // React Flow keeps measurement/selection state on its node objects, so we hold a local copy
  // and re-sync the concept data from the store whenever the graph changes.
  const highlight = useGraphStore((s) => s.highlight);
  const cycles = useMemo(() => cycleInfo(graph), [graph]);
  // Learning-path highlight: the chosen node plus everything it (transitively) depends on.
  const chain = useMemo(() => {
    const root = highlight?.graphId === graph.id ? graph.nodes.find((n) => n.id === highlight.nodeId) : undefined;
    return root ? new Set([root.id, ...prerequisiteClosure(graph, root.id)]) : null;
  }, [graph, highlight]);

  // View filters and focus mode hide concepts and relations; the learning-path highlight only dims them.
  const origins = useView((v) => v.origins);
  const todoOnly = useView((v) => v.todoOnly);
  const hops = useView((v) => v.hops);
  const focusState = useView((v) => v.focus);
  const setFocus = useView((v) => v.setFocus);
  const focus = useMemo(() => activeFocus({ focus: focusState, hops }, graph), [focusState, hops, graph]);
  const visible = useMemo(() => {
    const prefs = { origins, todoOnly, hops, edgeLabels: true };
    return showsEverything(prefs, focus) ? null : visibleParts(graph, prefs, focus);
  }, [graph, origins, todoOnly, hops, focus]);

  const [nodes, setNodes] = useState<ConceptFlowNode[]>([]);
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      let changed = prev.length !== graph.nodes.length;
      const next = graph.nodes.map((c, i) => {
        const old = byId.get(c.id);
        const className = chain ? (chain.has(c.id) ? "path-on" : "path-dim") : undefined;
        const inCycle = cycles.nodes.has(c.id);
        const hidden = visible ? !visible.nodes.has(c.id) : false;
        // Keep the very same object when nothing about this node changed: React Flow and the memoised
        // ConceptNode then skip it, so an AI status update of one node re-renders only that node.
        if (old && old.data.concept === c && old.data.inCycle === inCycle && old.className === className && !!old.hidden === hidden) {
          if (prev[i] !== old) changed = true;
          return old;
        }
        changed = true;
        return {
          ...(old ?? {}),
          id: c.id,
          type: "concept" as const,
          position: old?.dragging ? old.position : c.position,
          className,
          hidden,
          // A hidden concept can't stay selected (Delete and the toolbar act on the selection).
          selected: hidden ? false : old?.selected,
          data: { concept: c, inCycle },
        };
      });
      return changed ? next : prev;
    });
  }, [graph, chain, cycles, visible]);

  // Let the action layer place new nodes in view and pan/zoom to them (see lib/viewport.ts).
  const rf = useReactFlow<ConceptFlowNode, RelationFlowEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = (id: string) => {
      const c = activeGraph(useGraphStore.getState()).nodes.find((n) => n.id === id);
      if (!c) return null;
      const m = rf.getInternalNode(id)?.measured;
      return { x: c.position.x, y: c.position.y, w: m?.width ?? NODE_SIZE.w, h: m?.height ?? NODE_SIZE.h };
    };
    const centreOn = (b: { x: number; y: number; w: number; h: number }, zoom: number) =>
      void rf.setCenter(b.x + b.w / 2, b.y + b.h / 2, { zoom, duration: 400 });
    registerViewport({
      center() {
        const r = wrapper.current?.getBoundingClientRect();
        if (!r) return { x: 0, y: 0 };
        return rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      },
      reveal(id) {
        // Wait a frame so the new node is rendered and measured.
        requestAnimationFrame(() => {
          const b = box(id);
          const r = wrapper.current?.getBoundingClientRect();
          if (!b || !r) return;
          const { x, y, zoom } = rf.getViewport();
          const left = -x / zoom;
          const top = -y / zoom;
          const inView = b.x >= left && b.y >= top && b.x + b.w <= left + r.width / zoom && b.y + b.h <= top + r.height / zoom;
          if (!inView) centreOn(b, zoom);
        });
      },
      focus(id) {
        setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
        setSelection([id]);
        setInspect({ kind: "node", id });
        const b = box(id);
        if (b) centreOn(b, Math.max(rf.getZoom(), 0.8));
      },
      fit() {
        // After a layout the nodes move in the next render; fit once they have.
        requestAnimationFrame(() => void rf.fitView({ duration: 400, maxZoom: 1.2 }));
      },
    });
    return () => registerViewport(null);
  }, [rf, setSelection, setInspect]);

  // Edge objects are reused while their relation, classes and visibility stay the same (as for nodes above),
  // and so is the array itself when no edge changed: dragging a node or a status update then leaves edges alone.
  const edgeCache = useRef<RelationFlowEdge[]>([]);
  const edges = useMemo<RelationFlowEdge[]>(() => {
    const deps = new Map(graph.nodes.map((n) => [n.id, n.dependsOn]));
    const isDep = (x: string, y: string) => Boolean(deps.get(x)?.includes(y));
    const prev = new Map(edgeCache.current.map((e) => [e.id, e]));
    const next = graph.relations.map((r): RelationFlowEdge => {
      // Only dependency links inside the chain belong to the path; other relations between its nodes are dimmed.
      const onPath = chain && chain.has(r.a) && chain.has(r.b) && (isDep(r.a, r.b) || isDep(r.b, r.a));
      const className = chain ? (onPath ? "path-on" : "path-dim") : undefined;
      const cycle = cycles.links.has(linkKey(r.a, r.b)) || cycles.links.has(linkKey(r.b, r.a));
      const hidden = visible ? !visible.relations.has(r.id) : false;
      const old = prev.get(r.id);
      if (old?.data?.relation === r && old.data.cycle === cycle && old.className === className && !!old.hidden === hidden) return old;
      return { id: r.id, source: r.a, target: r.b, type: "bi" as const, className, hidden, data: { relation: r, cycle } };
    });
    const cached = edgeCache.current;
    if (next.length !== cached.length || next.some((e, i) => e !== cached[i])) edgeCache.current = next;
    return edgeCache.current;
  }, [graph, chain, cycles, visible]);

  // What gets hidden leaves the selection and the inspector, so Delete can't remove something that isn't shown.
  useEffect(() => {
    if (!visible) return;
    const s = useGraphStore.getState();
    const keep = s.selection.filter((id) => visible.nodes.has(id));
    if (keep.length !== s.selection.length) setSelection(keep);
    if (s.inspect?.kind === "edge" && !visible.relations.has(s.inspect.relationId)) setInspect(null);
  }, [visible, setSelection, setInspect]);

  // Entering focus mode, re-centring it or changing its radius fits the view to the neighbourhood;
  // leaving it returns to the view from before.
  const focusKey = focus ? `${focus.nodeId}:${focus.hops}` : null;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const beforeFocus = useRef<{ graphId: string; viewport: Viewport } | null>(null);
  useEffect(() => {
    if (!focusKey) {
      // Not after switching to another graph (that one fits its own view when it mounts).
      const b = beforeFocus.current;
      if (b?.graphId === graph.id) void rf.setViewport(b.viewport, { duration: 300 });
      beforeFocus.current = null;
      return;
    }
    beforeFocus.current ??= { graphId: graph.id, viewport: rf.getViewport() };
    // Two frames: the newly shown nodes render, then get measured.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const ids = [...(visibleRef.current?.nodes ?? [])].map((id) => ({ id }));
        if (ids.length) void rf.fitView({ nodes: ids, duration: 300, maxZoom: 1.2 });
      }),
    );
  }, [focusKey, rf]); // graph.id only matters when the focus changes, so it isn't a dependency

  const onNodesChange = useCallback(
    (changes: NodeChange<ConceptFlowNode>[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns));
    },
    [],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, _node: ConceptFlowNode, dragged: ConceptFlowNode[]) => {
      // One undo step per drag (all dragged nodes together); a drag that ends where it started is none.
      mutate((g) =>
        dragged.reduce((acc, n) => {
          const p = acc.nodes.find((c) => c.id === n.id)?.position;
          return p && p.x === n.position.x && p.y === n.position.y ? acc : updateNode(acc, n.id, { position: n.position });
        }, g),
      );
    },
    [mutate],
  );

  const onSelectionChange = useCallback(
    ({ nodes }: OnSelectionChangeParams) => {
      const ids = nodes.map((n) => n.id);
      setSelection(ids);
      if (ids.length === 1) setInspect({ kind: "node", id: ids[0] });
    },
    [setSelection, setInspect],
  );

  const onPaneClick = useCallback(() => setInspect(null), [setInspect]);
  const focusName = focus && graph.nodes.find((n) => n.id === focus.nodeId)?.name;

  return (
    <div ref={wrapper} className={`canvas${graph.parentId ? " canvas--sandbox" : ""}${chain ? " canvas--highlight" : ""}`}>
      <ReactFlow<ConceptFlowNode, RelationFlowEdge>
        key={graph.id}
        colorMode={theme}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        onPaneClick={onPaneClick}
        multiSelectionKeyCode={["Shift", "Meta", "Control"]}
        deleteKeyCode={null} // Delete/Backspace are handled in App so deletions are undoable
        nodesConnectable={false}
        fitView
        fitViewOptions={{ maxZoom: 1.2 }}
        minZoom={0.2}
        onlyRenderVisibleElements={graph.nodes.length >= LARGE_GRAPH}
      >
        <Background gap={24} />
        <Controls showInteractive={false}><ShortcutsButton /></Controls>
        <MiniMap pannable zoomable ariaLabel="Overview map" />
      </ReactFlow>
      {focus && (
        <div className="focus-bar" role="group" aria-label="Focus mode" data-testid="focus-bar">
          <span className="focus-bar__label">
            Focus: <b>{focusName}</b>
          </span>
          <select
            value={focus.hops}
            onChange={(e) => useView.getState().setPrefs({ hops: Number(e.target.value) })}
            onKeyDown={(e) => e.key === "Escape" && setFocus(null)} // App ignores keys while a select has focus
            aria-label="Focus radius"
            title="How many relation steps away from the focused concept to show"
          >
            {Array.from({ length: MAX_HOPS }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>within {h} {h === 1 ? "hop" : "hops"}</option>
            ))}
          </select>
          <button className="focus-bar__close" onClick={() => setFocus(null)} title="Show the whole graph (Esc)" aria-label="Leave focus mode">
            ✕
          </button>
        </div>
      )}
      {graph.nodes.length === 0 && (
        <div className="canvas__empty">
          <div>
            Add a concept to start. Describe it if you don't know its name — the AI will find one.
            <div className="canvas__example">
              {/* Built offline from static data (lib/examples.ts): no AI call, works without a key. */}
              <button onClick={loadExample} title="A small ready-made graph, with one concept blocked on a missing prerequisite">
                Load example: Group theory
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
