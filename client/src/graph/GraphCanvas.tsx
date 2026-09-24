import {
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { updateNode } from "../lib/graphOps";
import { cycleInfo, linkKey, prerequisiteClosure } from "../lib/paths";
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
  const highlight = useGraphStore((s) => s.highlight);
  const cycles = useMemo(() => cycleInfo(graph), [graph]);
  // Learning-path highlight: the chosen node plus everything it (transitively) depends on.
  const chain = useMemo(() => {
    const root = highlight?.graphId === graph.id ? graph.nodes.find((n) => n.id === highlight.nodeId) : undefined;
    return root ? new Set([root.id, ...prerequisiteClosure(graph, root.id)]) : null;
  }, [graph, highlight]);

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
          className: chain ? (chain.has(c.id) ? "path-on" : "path-dim") : undefined,
          data: { concept: c, inCycle: cycles.nodes.has(c.id) },
        };
      });
    });
  }, [graph, chain, cycles]);

  const edges = useMemo<RelationFlowEdge[]>(() => {
    const deps = new Map(graph.nodes.map((n) => [n.id, n.dependsOn]));
    const isDep = (x: string, y: string) => Boolean(deps.get(x)?.includes(y));
    return graph.relations.map((r) => {
      // Only dependency links inside the chain belong to the path; other relations between its nodes are dimmed.
      const onPath = chain && chain.has(r.a) && chain.has(r.b) && (isDep(r.a, r.b) || isDep(r.b, r.a));
      return {
        id: r.id,
        source: r.a,
        target: r.b,
        type: "bi" as const,
        className: chain ? (onPath ? "path-on" : "path-dim") : undefined,
        data: { relation: r, cycle: cycles.links.has(linkKey(r.a, r.b)) || cycles.links.has(linkKey(r.b, r.a)) },
      };
    });
  }, [graph, chain, cycles]);

  const onNodesChange = useCallback(
    (changes: NodeChange<ConceptFlowNode>[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns));
    },
    [],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, _node: ConceptFlowNode, dragged: ConceptFlowNode[]) => {
      mutate((g) => dragged.reduce((acc, n) => updateNode(acc, n.id, { position: n.position }), g));
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
    <div className={`canvas${graph.parentId ? " canvas--sandbox" : ""}${chain ? " canvas--highlight" : ""}`}>
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
        deleteKeyCode={null}
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
