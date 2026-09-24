import {
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NODE_SIZE, updateNode } from "../lib/graphOps";
import { registerViewport } from "../lib/viewport";
import { activeGraph, useGraphStore } from "../store/graphStore";
import { BiRelationEdge, type RelationFlowEdge } from "./BiRelationEdge";
import { ConceptNode, type ConceptFlowNode } from "./ConceptNode";

const nodeTypes = { concept: ConceptNode };
const edgeTypes = { bi: BiRelationEdge };

export function GraphCanvas() {
  const graph = useGraphStore(activeGraph);
  const mutate = useGraphStore((s) => s.mutate);
  const setSelection = useGraphStore((s) => s.setSelection);
  const setInspect = useGraphStore((s) => s.setInspect);

  // React Flow keeps measurement/selection state on its node objects, so we hold a local copy
  // and re-sync the concept data from the store whenever the graph changes.
  const [nodes, setNodes] = useState<ConceptFlowNode[]>([]);
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return graph.nodes.map((c) => {
        const old = byId.get(c.id);
        return {
          ...(old ?? {}),
          id: c.id,
          type: "concept" as const,
          position: old?.dragging ? old.position : c.position,
          data: { concept: c },
        };
      });
    });
  }, [graph]);

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

  const edges = useMemo<RelationFlowEdge[]>(
    () => graph.relations.map((r) => ({ id: r.id, source: r.a, target: r.b, type: "bi" as const, data: { relation: r } })),
    [graph.relations],
  );

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

  return (
    <div ref={wrapper} className={`canvas${graph.parentId ? " canvas--sandbox" : ""}`}>
      <ReactFlow<ConceptFlowNode, RelationFlowEdge>
        key={graph.id}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        onPaneClick={() => setInspect(null)}
        multiSelectionKeyCode={["Shift", "Meta", "Control"]}
        deleteKeyCode={null} // Delete/Backspace are handled in App so deletions are undoable
        nodesConnectable={false}
        fitView
        fitViewOptions={{ maxZoom: 1.2 }}
        minZoom={0.2}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
      {graph.nodes.length === 0 && (
        <div className="canvas__empty">
          Add a concept to start. Describe it if you don't know its name — the AI will find one.
        </div>
      )}
    </div>
  );
}
