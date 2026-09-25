import type { Graph } from "@nodestorm/shared";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { setPositions } from "../lib/graphOps";
import { createSim, graphLinks, isSettled, reheat, setFixed, settle, simPositions, step, type Sim } from "../lib/physics";
import { useGraphStore } from "../store/graphStore";
import type { ConceptFlowNode } from "./ConceptNode";

type XY = { x: number; y: number };

/** Graphs this large are too slow to simulate smoothly in the browser. */
export const PHYSICS_MAX_NODES = 400;

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Live Physics on the canvas: while `enabled`, the simulation (lib/physics.ts) moves the on-screen cards every
 * animation frame; a dragged card is held at the pointer and pulls its neighbours; pinned cards stay put. Once it
 * settles, the positions are saved as one undo step (together with the drag that started it). In the read-only viewer
 * the store ignores the save, so the arrangement is only on screen.
 */
export function usePhysics(opts: {
  enabled: boolean;
  graph: Graph;
  /** Where each concept is drawn when nothing moves (its position, or its place in the layered view). */
  display: (id: string) => XY;
  /** The concepts on screen (null: all). */
  visible: Set<string> | null;
  /** Layered view: cards move along their layer's row only. */
  lockY: boolean;
  /** Converts an on-screen position back to the stored one. */
  toStore: (id: string, at: XY) => XY;
  setNodes: Dispatch<SetStateAction<ConceptFlowNode[]>>;
  /** Current on-screen positions (to carry on from where the cards are). */
  onScreen: () => Map<string, XY>;
}) {
  const { enabled, graph, visible, lockY } = opts;
  const latest = useRef(opts);
  latest.current = opts;
  const sim = useRef<{ sim: Sim; lockY: boolean } | null>(null);
  const frame = useRef(0);
  const heat = useRef(0);
  const [settling, setSettling] = useState(false);

  // What the simulation is built from: which cards, which springs, which are pinned. Positions aren't part of it.
  const structure = useMemo(() => {
    const ids = graph.nodes.filter((n) => !visible || visible.has(n.id)).map((n) => `${n.id}${n.pinned ? "*" : ""}`);
    const links = graphLinks(graph, visible ?? undefined).map((l) => `${l.a}>${l.b}${l.prereq ? "!" : ""}`);
    return `${graph.id}|${lockY}|${ids.join(",")}|${links.sort().join(",")}`;
  }, [graph, visible, lockY]);

  const key = useCallback(() => `physics:${latest.current.graph.id}:${heat.current}`, []);

  /** Save where the simulation put the cards (only those that moved). */
  const commit = useCallback(() => {
    const s = sim.current?.sim;
    if (!s) return;
    const { graph: g, toStore } = latest.current;
    const moved = new Map<string, XY>();
    const positions = new Map(g.nodes.map((n) => [n.id, n.position]));
    for (const [id, at] of simPositions(s)) {
      const stored = toStore(id, at);
      const now = positions.get(id);
      if (now && (now.x !== stored.x || now.y !== stored.y)) moved.set(id, stored);
    }
    if (moved.size) useGraphStore.getState().mutate((x) => setPositions(x, moved), g.id, { key: key() });
  }, [key]);

  /** Show the simulation's positions (leaving a card being dragged where the pointer has it). */
  const paint = useCallback(() => {
    const s = sim.current?.sim;
    if (!s) return;
    const at = simPositions(s);
    latest.current.setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const p = at.get(n.id);
        if (!p || n.dragging || (p.x === n.position.x && p.y === n.position.y)) return n;
        changed = true;
        return { ...n, position: p };
      });
      return changed ? next : ns;
    });
  }, []);

  const run = useCallback(() => {
    if (frame.current || !sim.current) return;
    setSettling(true);
    const tick = () => {
      const s = sim.current?.sim;
      if (!s) {
        frame.current = 0;
        return;
      }
      // Two steps a frame: a calm but brisk pace (a few seconds for a fresh graph).
      step(s);
      step(s);
      paint();
      if (isSettled(s)) {
        frame.current = 0;
        setSettling(false);
        commit();
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [paint, commit]);

  const stop = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    setSettling(false);
  }, []);

  // (Re)build the simulation when Physics is switched on or the cards or springs change.
  useEffect(() => {
    if (!enabled) {
      if (sim.current && !isSettled(sim.current.sim)) commit(); // switched off mid-way: keep what is on screen
      stop();
      sim.current = null;
      return;
    }
    const { graph: g, display, onScreen, visible: vis } = latest.current;
    // Carry on from where the cards are, unless the view changed (flat and layered positions differ).
    const current = sim.current?.lockY === lockY ? onScreen() : null;
    const nodes = g.nodes
      .filter((n) => !vis || vis.has(n.id))
      .map((n) => ({ id: n.id, ...(current?.get(n.id) ?? display(n.id)), fixed: Boolean(n.pinned) }));
    sim.current = { sim: createSim(nodes, graphLinks(g, vis ?? undefined), { lockY }), lockY };
    heat.current++;
    if (reducedMotion()) {
      settle(sim.current.sim);
      paint();
      commit();
      return;
    }
    stop();
    run();
    return stop;
  }, [enabled, structure, lockY, run, stop, paint, commit]);

  const onDragStart = useCallback((dragged: ConceptFlowNode[]) => {
    const s = sim.current?.sim;
    if (!s) return;
    heat.current++; // the drag and the settling after it are one undo step
    // Start from where the cards are now (an Undo may have moved them since the last run).
    const now = latest.current.onScreen();
    for (const b of s.bodies) {
      const p = now.get(b.id);
      if (p) setFixed(s, b.id, b.fixed, p);
    }
    for (const n of dragged) setFixed(s, n.id, true, n.position);
  }, []);

  const onDrag = useCallback(
    (dragged: ConceptFlowNode[]) => {
      const s = sim.current?.sim;
      if (!s) return;
      for (const n of dragged) setFixed(s, n.id, true, n.position);
      reheat(s, 0.4);
      if (!reducedMotion()) run();
    },
    [run],
  );

  /** Let go of the dragged cards (pinned ones stay held). Returns the undo key the drag should use, if any. */
  const onDragStop = useCallback(
    (dragged: ConceptFlowNode[]): string | undefined => {
      const s = sim.current?.sim;
      if (!s) return undefined;
      for (const n of dragged) setFixed(s, n.id, Boolean(n.data.concept.pinned), n.position);
      reheat(s, 0.4);
      if (reducedMotion()) {
        settle(s);
        paint();
        queueMicrotask(commit); // after the drag's own save, into the same undo step
      } else run();
      return key();
    },
    [run, paint, key, commit],
  );

  useEffect(() => stop, [stop]);

  return { settling, onDragStart, onDrag, onDragStop };
}
