import {
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  useStore,
  type NodeChange,
  type NodePositionChange,
  type OnSelectionChangeParams,
  type Viewport,
} from "@xyflow/react";
import { Focus, Network, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rich, useT } from "../i18n";
import { NODE_SIZE, updateNode } from "../lib/graphOps";
import { dependencyLayers, fromLayered, LAYERED, layeredView } from "../lib/layout";
import { cycleInfo, linkKey, prerequisiteClosure } from "../lib/paths";
import { useTheme } from "../lib/theme";
import { DEFAULT_VIEW, MAX_HOPS, showsEverything, visibleParts } from "../lib/view";
import { registerViewport, viewport } from "../lib/viewport";
import { ShortcutsButton } from "../panels/ShortcutsHelp";
import { activeGraph, isViewing, useGraphStore } from "../store/graphStore";
import { HiddenBar } from "../panels/HiddenBar";
import { activeFocus, hiddenIn, useView } from "../store/viewStore";
import { Icon } from "../ui/Icon";
import { BiRelationEdge, type RelationFlowEdge } from "./BiRelationEdge";
import { ConceptNode, type ConceptFlowNode } from "./ConceptNode";
import { LayerPlates } from "./LayerPlates";
import { PHYSICS_MAX_NODES, usePhysics } from "./usePhysics";

const nodeTypes = { concept: ConceptNode };
const edgeTypes = { bi: BiRelationEdge };

/** From this many concepts on, only what is on screen is rendered (React Flow's onlyRenderVisibleElements). */
const LARGE_GRAPH = 150;
/** Below this zoom a card's description is too small to read: cards then show just their name, larger. */
export const FAR_ZOOM = 0.6;

export function GraphCanvas() {
  const t = useT();
  const graph = useGraphStore(activeGraph);
  const mutate = useGraphStore((s) => s.mutate);
  const setSelection = useGraphStore((s) => s.setSelection);
  const setInspect = useGraphStore((s) => s.setInspect);
  const theme = useTheme((s) => s.theme);
  const viewing = useGraphStore(isViewing);
  // A boolean selector: the canvas re-renders when the zoom crosses the threshold, not on every zoom step.
  const far = useStore((st) => st.transform[2] < FAR_ZOOM);
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
  const kinds = useView((v) => v.kinds);
  const hops = useView((v) => v.hops);
  const focusState = useView((v) => v.focus);
  const setFocus = useView((v) => v.setFocus);
  const focus = useMemo(() => activeFocus({ focus: focusState, hops }, graph), [focusState, hops, graph]);
  // Concepts hidden by hand (the inspector's Hide, H): gone from the canvas, the minimap and fit-view alike.
  const hiddenIds = useView(hiddenIn(graph.id));
  const visible = useMemo(() => {
    const prefs = { ...DEFAULT_VIEW, origins, todoOnly, hops, kinds };
    const hidden = new Set(hiddenIds);
    return showsEverything(prefs, focus, hidden) ? null : visibleParts(graph, prefs, focus, hidden);
  }, [graph, origins, todoOnly, hops, kinds, focus, hiddenIds]);

  // Layered (2.5D) view: each concept is drawn on its dependency layer's plate (lib/layout.ts layeredView); the
  // stored positions stay as they are, so switching back to the flat view restores the layout.
  const layout = useView((v) => v.layout);
  const physicsOn = useView((v) => v.physics) && graph.nodes.length <= PHYSICS_MAX_NODES;
  const layers = useMemo(() => (layout === "layered" ? dependencyLayers(graph) : null), [graph, layout]);
  const display = useMemo(() => (layers ? layeredView(graph, layers) : null), [graph, layers]);
  const displayRef = useRef({ display, layers, graph });
  displayRef.current = { display, layers, graph };
  const posOf = useCallback((id: string) => {
    const { display: d, graph: g } = displayRef.current;
    return d?.get(id) ?? g.nodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 };
  }, []);
  /** On-screen position → stored position (in the layered view only x is the card's own; y is its layer's row). */
  const toStore = useCallback((id: string, at: { x: number; y: number }) => {
    const { layers: ls, graph: g } = displayRef.current;
    const stored = g.nodes.find((n) => n.id === id)?.position ?? at;
    return ls ? { x: fromLayered(at.x, ls.get(id) ?? 0), y: stored.y } : at;
  }, []);

  const [nodes, setNodes] = useState<ConceptFlowNode[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const physics = usePhysics({
    enabled: physicsOn,
    graph,
    display: posOf,
    visible: visible?.nodes ?? null,
    lockY: layout === "layered",
    toStore,
    setNodes,
    onScreen: () => new Map(nodesRef.current.map((n) => [n.id, n.position])),
  });
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      let changed = prev.length !== graph.nodes.length;
      const next = graph.nodes.map((c, i) => {
        const old = byId.get(c.id);
        const className = chain ? (chain.has(c.id) ? "path-on" : "path-dim") : undefined;
        const inCycle = cycles.nodes.has(c.id);
        const hidden = visible ? !visible.nodes.has(c.id) : false;
        const at = display?.get(c.id) ?? c.position;
        // While Physics is moving cards it owns their positions; otherwise (Undo included) a card sits where the view puts it.
        // (In the read-only viewer nothing is saved, so Physics keeps them where it put them.)
        const moving = physicsOn && (physics.settling || viewing);
        const placed = moving || old?.dragging || (old?.position.x === at.x && old.position.y === at.y);
        // Keep the very same object when nothing about this node changed: React Flow and the memoised
        // ConceptNode then skip it, so an AI status update of one node re-renders only that node.
        if (old && placed && old.data.concept === c && old.data.inCycle === inCycle && old.className === className && !!old.hidden === hidden) {
          if (prev[i] !== old) changed = true;
          return old;
        }
        changed = true;
        return {
          ...(old ?? {}),
          id: c.id,
          type: "concept" as const,
          position: old?.dragging || (moving && old) ? old.position : at,
          className,
          hidden,
          // A hidden concept can't stay selected (Delete and the toolbar act on the selection).
          selected: hidden ? false : old?.selected,
          data: { concept: c, inCycle },
        };
      });
      return changed ? next : prev;
    });
  }, [graph, chain, cycles, visible, display, physicsOn, physics.settling, viewing]);


  // Let the action layer place new nodes in view and pan/zoom to them (see lib/viewport.ts).
  const rf = useReactFlow<ConceptFlowNode, RelationFlowEdge>();
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = (id: string) => {
      const c = activeGraph(useGraphStore.getState()).nodes.find((n) => n.id === id);
      if (!c) return null;
      const internal = rf.getInternalNode(id);
      const m = internal?.measured;
      // Where the card is on screen (the layered view and Physics move it away from its stored position).
      const p = internal?.position ?? c.position;
      return { x: p.x, y: p.y, w: m?.width ?? NODE_SIZE.w, h: m?.height ?? NODE_SIZE.h };
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
      // In the layered view a card slides along its layer's row: the layer comes from its prerequisites.
      const ls = displayRef.current.layers;
      const kept = ls
        ? changes.map((c): NodeChange<ConceptFlowNode> =>
            c.type === "position" && c.position ? ({ ...c, position: { x: c.position.x, y: (ls.get(c.id) ?? 0) * LAYERED.dy } } as NodePositionChange) : c,
          )
        : changes;
      setNodes((ns) => applyNodeChanges(kept, ns));
    },
    [],
  );

  const { onDragStart, onDrag, onDragStop } = physics;
  const onNodeDragStart = useCallback((_: unknown, _node: ConceptFlowNode, dragged: ConceptFlowNode[]) => onDragStart(dragged), [onDragStart]);
  const onNodeDrag = useCallback((_: unknown, _node: ConceptFlowNode, dragged: ConceptFlowNode[]) => onDrag(dragged), [onDrag]);
  const onNodeDragStop = useCallback(
    (_: unknown, _node: ConceptFlowNode, dragged: ConceptFlowNode[]) => {
      // With Physics on, the drag and the settling it sets off are one undo step.
      const key = onDragStop(dragged);
      // One undo step per drag (all dragged nodes together); a drag that ends where it started is none.
      mutate(
        (g) =>
          dragged.reduce((acc, n) => {
            const p = acc.nodes.find((c) => c.id === n.id)?.position;
            const to = toStore(n.id, n.position);
            return p && p.x === to.x && p.y === to.y ? acc : updateNode(acc, n.id, { position: to });
          }, g),
        undefined,
        key ? { key } : undefined,
      );
    },
    [mutate, onDragStop, toStore],
  );

  // With Physics on, a double-click pins a card in place (or lets it go again).
  const onNodeDoubleClick = useCallback(
    (_: unknown, node: ConceptFlowNode) => {
      if (!physicsOn) return;
      mutate((g) => updateNode(g, node.id, { pinned: node.data.concept.pinned ? undefined : true }));
    },
    [mutate, physicsOn],
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
    <div
      ref={wrapper}
      className={`canvas${graph.parentId ? " canvas--sandbox" : ""}${chain ? " canvas--highlight" : ""}${layers ? " canvas--layered" : ""}${far ? " canvas--far" : ""}`}
      data-settled={physicsOn ? String(!physics.settling) : undefined}
    >
      <ReactFlow<ConceptFlowNode, RelationFlowEdge>
        key={graph.id}
        colorMode={theme}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
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
        {layers && <LayerPlates nodes={nodes} layers={layers} />}
        <Controls showInteractive={false}><ShortcutsButton /></Controls>
        <MiniMap pannable zoomable ariaLabel={t("canvas.map")} />
      </ReactFlow>
      {physics.settling && (
        <div className="physics-badge" role="status" data-testid="physics-settling">
          <span className="spinner spinner--xs" aria-hidden="true" />
          {t("physics.settling")}
        </div>
      )}
      {focus && (
        <div className="focus-bar" role="group" aria-label={t("focus.bar")} data-testid="focus-bar">
          <Icon icon={Focus} size={14} className="focus-bar__icon" />
          <span className="focus-bar__label">{rich("focus.label", { name: focusName })}</span>
          <select
            value={focus.hops}
            onChange={(e) => useView.getState().setPrefs({ hops: Number(e.target.value) })}
            onKeyDown={(e) => e.key === "Escape" && setFocus(null)} // App ignores keys while a select has focus
            aria-label={t("focus.radius")}
            title={t("focus.radiusTitle")}
          >
            {Array.from({ length: MAX_HOPS }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>{t("focus.hops", { n: h })}</option>
            ))}
          </select>
          <button className="focus-bar__close icon-btn" onClick={() => setFocus(null)} title={t("focus.close")} aria-label={t("focus.leave")}>
            <Icon icon={X} size={14} />
          </button>
        </div>
      )}
      <HiddenBar />
      {graph.nodes.length === 0 && (
        <div className="canvas__empty">
          <div className="canvas__emptyCard">
            <span className="canvas__emptyIcon"><Icon icon={Network} size={20} /></span>
            <p>{t("canvas.empty")}</p>
            <div className="canvas__example">
              {/* Built offline from static data (lib/examples.ts): no AI call, works without a key. */}
              <button onClick={loadExample} title={t("canvas.exampleTitle")}>
                {t("canvas.example")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
