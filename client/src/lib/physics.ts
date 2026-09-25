import type { Graph } from "@nodestorm/shared";
import { NODE_SIZE } from "./graphOps";

/**
 * "Physics": a small force simulation that sorts concepts by their connections. Relations are springs, nodes repel
 * each other and never overlap (their cards are rectangles), and a prerequisite drifts above what needs it. Pure and
 * deterministic (no Math.random): the canvas steps it once per animation frame (graph/usePhysics.ts), tests step it
 * in a loop. Positions are top-left corners, as React Flow and the graph store use them.
 */

export interface SimNode {
  id: string;
  x: number;
  y: number;
  /** Held in place: pinned by the user, or being dragged. */
  fixed?: boolean;
}

export interface SimLink {
  a: string;
  b: string;
  /** Set for a dependency link: `a` is the prerequisite of `b` (stiffer, and `a` sits above). */
  prereq?: boolean;
}

export interface SimOptions {
  /** Rest length of a spring, between node centres. */
  rest?: number;
  /** Layered mode: y never changes (each node stays on its layer's row), only x moves. */
  lockY?: boolean;
  /** Vertical distance a dependent keeps below its prerequisite (not in layered mode, where layers decide). */
  rowGap?: number;
}

interface Body {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
}

export interface Sim {
  bodies: Body[];
  links: { i: number; j: number; prereq: boolean }[];
  alpha: number;
  ticks: number;
  opts: Required<SimOptions>;
  /** Where the graph was when the simulation started: a faint pull keeps it from drifting away. */
  centre: { x: number; y: number };
}

const { w: W, h: H } = NODE_SIZE;
/** Clear space kept between two cards. */
const PAD = 36;
const SPRING = 0.035;
const PREREQ_SPRING = 0.06;
const CHARGE = 90_000;
/** Beyond this distance (between centres) nodes don't repel: far-apart clusters stop pushing each other. */
const REACH = 900;
const DAMPING = 0.55;
const MAX_SPEED = 60;
const COOLING = 0.985;
const SETTLED_ALPHA = 0.02;
const GRID_ABOVE = 150;

export function createSim(nodes: SimNode[], links: SimLink[], opts: SimOptions = {}): Sim {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const seen = new Set<string>();
  const out: Sim["links"] = [];
  for (const l of links) {
    const i = index.get(l.a);
    const j = index.get(l.b);
    if (i === undefined || j === undefined || i === j) continue;
    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    const prior = seen.has(key) ? out.find((x) => (x.i === i && x.j === j) || (x.i === j && x.j === i)) : undefined;
    if (prior) {
      // One spring per pair; a dependency wins over a plain relation.
      if (l.prereq && !prior.prereq) Object.assign(prior, { i, j, prereq: true });
      continue;
    }
    seen.add(key);
    out.push({ i, j, prereq: Boolean(l.prereq) });
  }
  const bodies = nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, vx: 0, vy: 0, fixed: Boolean(n.fixed) }));
  const centre = bodies.length
    ? { x: bodies.reduce((s, b) => s + b.x, 0) / bodies.length, y: bodies.reduce((s, b) => s + b.y, 0) / bodies.length }
    : { x: 0, y: 0 };
  return {
    bodies,
    links: out,
    alpha: 1,
    ticks: 0,
    opts: { rest: opts.rest ?? 320, lockY: Boolean(opts.lockY), rowGap: opts.rowGap ?? H + 90 },
    centre,
  };
}

/** Wake the simulation up (after a drag, or when concepts or links change). */
export function reheat(sim: Sim, alpha = 0.5) {
  sim.alpha = Math.max(sim.alpha, alpha);
}

/** Hold a node where it is (or let it go again). Unknown ids are ignored. */
export function setFixed(sim: Sim, id: string, fixed: boolean, at?: { x: number; y: number }) {
  const b = sim.bodies.find((x) => x.id === id);
  if (!b) return;
  b.fixed = fixed;
  b.vx = b.vy = 0;
  if (at) {
    b.x = at.x;
    if (!sim.opts.lockY) b.y = at.y;
  }
}

export const isSettled = (sim: Sim) => sim.alpha < SETTLED_ALPHA;

/** Pairs of bodies close enough to interact: all pairs for small graphs, a uniform grid for large ones. */
function nearPairs(bodies: Body[], reach: number): [number, number][] {
  const pairs: [number, number][] = [];
  if (bodies.length <= GRID_ABOVE) {
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) pairs.push([i, j]);
    return pairs;
  }
  const cells = new Map<string, number[]>();
  const cell = (b: Body) => [Math.floor(b.x / reach), Math.floor(b.y / reach)];
  bodies.forEach((b, i) => {
    const [cx, cy] = cell(b);
    const k = `${cx},${cy}`;
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(i);
  });
  bodies.forEach((b, i) => {
    const [cx, cy] = cell(b);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) if (j > i) pairs.push([i, j]);
      }
    }
  });
  return pairs;
}

/** A deterministic nudge for two nodes on exactly the same spot (so they can be pushed apart). */
const nudge = (i: number, j: number) => (((i * 7919 + j * 104729) % 17) - 8) / 8 || 0.5;

/**
 * One tick. Returns the largest distance any node moved, so a caller can tell it came to rest. Cools the simulation;
 * once `isSettled`, further steps do nothing until `reheat`.
 */
export function step(sim: Sim): number {
  if (isSettled(sim)) return 0;
  const { bodies, links, alpha, opts } = sim;
  const lockY = opts.lockY;
  const fx = new Float64Array(bodies.length);
  const fy = new Float64Array(bodies.length);

  // Springs between related concepts (centre to centre; top-left corners differ by the same offset).
  for (const { i, j, prereq } of links) {
    const a = bodies[i];
    const b = bodies[j];
    let dx = b.x - a.x;
    let dy = lockY ? 0 : b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = ((prereq ? PREREQ_SPRING : SPRING) * (d - opts.rest) * alpha) / d;
    dx *= f;
    dy *= f;
    fx[i] += dx;
    fy[i] += dy;
    fx[j] -= dx;
    fy[j] -= dy;
    // A dependent that isn't comfortably below its prerequisite is pushed down (and the prerequisite up).
    if (prereq && !lockY) {
      const short = a.y + opts.rowGap - b.y;
      if (short > 0) {
        const g = short * 0.08 * alpha;
        fy[i] -= g;
        fy[j] += g;
      }
    }
  }

  // Repulsion between nearby concepts.
  for (const [i, j] of nearPairs(bodies, REACH)) {
    const a = bodies[i];
    const b = bodies[j];
    let dx = b.x - a.x;
    let dy = lockY ? 0 : b.y - a.y;
    if (lockY && Math.abs(b.y - a.y) >= H) continue; // other layers don't push along a row
    if (dx === 0 && dy === 0) dx = nudge(i, j);
    const d2 = dx * dx + dy * dy;
    if (d2 > REACH * REACH) continue;
    const d = Math.sqrt(d2);
    const f = (CHARGE * alpha) / Math.max(d2, 900) / d;
    fx[i] -= dx * f;
    fy[i] -= dy * f;
    fx[j] += dx * f;
    fy[j] += dy * f;
  }

  // Integrate, with a faint pull back to where the graph started so loose parts don't wander off.
  let moved = 0;
  bodies.forEach((b, i) => {
    if (b.fixed) return;
    b.vx = (b.vx + fx[i] + (sim.centre.x - b.x) * 0.002 * alpha) * DAMPING;
    b.vy = lockY ? 0 : (b.vy + fy[i] + (sim.centre.y - b.y) * 0.002 * alpha) * DAMPING;
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > MAX_SPEED) {
      b.vx *= MAX_SPEED / speed;
      b.vy *= MAX_SPEED / speed;
    }
    b.x += b.vx;
    b.y += b.vy;
  });

  moved = Math.max(moved, separate(sim), separate(sim));
  for (const b of bodies) moved = Math.max(moved, Math.hypot(b.vx, b.vy));
  sim.alpha *= COOLING;
  sim.ticks++;
  // Nothing left to sort out: stop early rather than creep for the rest of the cooling.
  if (sim.ticks > 30 && moved < 0.3) sim.alpha = 0;
  return moved;
}

/** Push overlapping cards apart along the axis where they overlap least. Returns the largest push. */
function separate(sim: Sim): number {
  const { bodies } = sim;
  const lockY = sim.opts.lockY;
  let most = 0;
  for (const [i, j] of nearPairs(bodies, W + PAD)) {
    const a = bodies[i];
    const b = bodies[j];
    if (a.fixed && b.fixed) continue;
    let dx = b.x - a.x;
    const dy = b.y - a.y;
    const ox = W + PAD - Math.abs(dx);
    const oy = H + PAD - Math.abs(dy);
    if (ox <= 0 || oy <= 0) continue;
    if (lockY && Math.abs(dy) >= H) continue; // different layers
    if (dx === 0) dx = nudge(i, j);
    const alongX = lockY || ox < oy;
    const push = alongX ? ox : oy;
    const sign = alongX ? Math.sign(dx) : Math.sign(dy) || 1;
    const share = a.fixed ? [0, 1] : b.fixed ? [1, 0] : [0.5, 0.5];
    if (alongX) {
      a.x -= sign * push * share[0];
      b.x += sign * push * share[1];
    } else {
      a.y -= sign * push * share[0];
      b.y += sign * push * share[1];
    }
    most = Math.max(most, push);
  }
  return most;
}

/** Run until it settles (or `maxTicks`); returns the number of ticks taken. For reduced motion and tests. */
export function settle(sim: Sim, maxTicks = 1000): number {
  const start = sim.ticks;
  while (!isSettled(sim) && sim.ticks - start < maxTicks) step(sim);
  return sim.ticks - start;
}

/** Current positions, rounded to whole pixels (as stored in the graph). */
export function simPositions(sim: Sim): Map<string, { x: number; y: number }> {
  return new Map(sim.bodies.map((b) => [b.id, { x: Math.round(b.x), y: Math.round(b.y) }]));
}

/**
 * The springs of a graph: one per relation between two of `ids` (the concepts on screen). A relation whose ends are
 * prerequisite and dependent is a dependency spring, pointing from the prerequisite.
 */
export function graphLinks(g: Graph, ids?: Set<string>): SimLink[] {
  const deps = new Map(g.nodes.map((n) => [n.id, new Set(n.dependsOn)]));
  const out: SimLink[] = [];
  const add = (a: string, b: string, prereq: boolean) => {
    if (!ids || (ids.has(a) && ids.has(b))) out.push({ a, b, prereq });
  };
  for (const r of g.relations) {
    if (deps.get(r.b)?.has(r.a)) add(r.a, r.b, true);
    else if (deps.get(r.a)?.has(r.b)) add(r.b, r.a, true);
    else add(r.a, r.b, false);
  }
  // A prerequisite without a drawn relation still pulls.
  for (const n of g.nodes) for (const p of n.dependsOn) add(p, n.id, true);
  return out;
}
