import type { ConceptNode, Graph } from "@nodestorm/shared";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { NODE_SIZE } from "../lib/graphOps";
import { KIND_TONE } from "../lib/kinds";

/**
 * The 3D view's scene (three.js, loaded only with the 3D dialog): one horizontal plate per dependency layer,
 * foundations at the top, each concept a card facing the camera above its plate at its canvas position, relations
 * as lines between them. Look-only: rotate, zoom, pan, and click a card to open it.
 */

export interface SceneColors {
  bg: string;
  panel: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentSoft: string;
  edge: string;
  blocked: string;
  kind: Record<string, string>;
}

/** The theme's colours, from the CSS custom properties on <html>. */
export function themeColors(): SceneColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--bg", "#f6f7f9"),
    panel: v("--panel", "#ffffff"),
    text: v("--text", "#1b1e25"),
    muted: v("--muted", "#5b6270"),
    border: v("--border-strong", "#d1d5dc"),
    accent: v("--accent", "#4f46e5"),
    accentSoft: v("--accent-soft", "#eef0ff"),
    edge: v("--edge", "#9aa1ad"),
    blocked: v("--blocked", "#b42318"),
    kind: Object.fromEntries(["def", "result", "axiom", "conj", "example", "other"].map((k) => [k, v(`--kind-${k}`, v("--muted", "#5b6270"))])),
  };
}

/** Canvas units per world unit: the 2D canvas is in pixels, the 3D world in tidy small numbers. */
const SCALE = 1 / 100;
/** Height between two layers. */
const STOREY = 2.6;
const CARD = { w: 3, h: 0.98 };

export interface Scene3D {
  dispose(): void;
  resetView(): void;
  rotate(dx: number, dy: number): void;
  zoom(factor: number): void;
}

/** Card texture: the concept's name on a rounded card with its kind's colour along the left edge. */
function cardTexture(n: ConceptNode, colors: SceneColors, hover: boolean): THREE.CanvasTexture {
  const scale = 2;
  const w = 440 * scale;
  const h = 144 * scale;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const r = 22 * scale;
  g.beginPath();
  g.roundRect(3, 3, w - 6, h - 6, r);
  g.fillStyle = colors.panel;
  g.fill();
  g.lineWidth = (hover ? 6 : 3) * scale;
  g.strokeStyle = hover ? colors.accent : n.status === "blocked" ? colors.blocked : colors.border;
  g.stroke();
  const tone = n.kind ? KIND_TONE[n.kind] : "other";
  g.fillStyle = colors.kind[tone] ?? colors.muted;
  g.beginPath();
  g.roundRect(3, 3, 14 * scale, h - 6, [r, 0, 0, r]);
  g.fill();
  // Name, on up to two lines.
  g.fillStyle = colors.text;
  g.textBaseline = "middle";
  // Name, on as few lines as fit (up to three, the font shrinking for long names).
  const wrap = (size: number) => {
    g.font = `600 ${size * scale}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const lines: string[] = [];
    let line = "";
    for (const word of n.name.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width > w - 60 * scale && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
    return lines;
  };
  let size = 38;
  let lines = wrap(size);
  while (lines.length > 2 && size > 28) lines = wrap((size -= 4));
  const shown = lines.slice(0, 3);
  if (lines.length > 3) shown[2] = `${shown[2].replace(/.{0,2}$/, "")}…`;
  const lh = size * 1.18 * scale;
  shown.forEach((l, i) => g.fillText(l, 34 * scale, h / 2 + (i - (shown.length - 1) / 2) * lh));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A text label as a sprite (for the layer names). */
function labelSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = `600 56px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width) + 20;
  c.height = 80;
  g.font = font;
  g.fillStyle = color;
  g.textBaseline = "middle";
  g.fillText(text, 10, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set((c.width / c.height) * 0.36, 0.36, 1);
  s.renderOrder = 1;
  return s;
}

export function createScene(opts: {
  canvas: HTMLCanvasElement;
  graph: Graph;
  layers: Map<string, number>;
  colors: SceneColors;
  labels: { layer: (n: number) => string };
  reducedMotion: boolean;
  onPick: (id: string) => void;
  onHover: (name: string | null) => void;
}): Scene3D {
  const { canvas, graph, layers, colors } = opts;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(colors.bg);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !opts.reducedMotion;
  controls.autoRotate = !opts.reducedMotion;
  controls.autoRotateSpeed = 0.6;
  const stopSpin = () => (controls.autoRotate = false);
  canvas.addEventListener("pointerdown", stopSpin);
  canvas.addEventListener("wheel", stopSpin, { passive: true });

  // Centre the graph on the origin; foundations (layer 0) are the top storey.
  const depth = Math.max(0, ...layers.values());
  const cx = graph.nodes.reduce((s, n) => s + n.position.x + NODE_SIZE.w / 2, 0) / Math.max(1, graph.nodes.length);
  const cz = graph.nodes.reduce((s, n) => s + n.position.y + NODE_SIZE.h / 2, 0) / Math.max(1, graph.nodes.length);
  const place = (n: ConceptNode) =>
    new THREE.Vector3(
      (n.position.x + NODE_SIZE.w / 2 - cx) * SCALE,
      ((depth - (layers.get(n.id) ?? 0)) - depth / 2) * STOREY,
      (n.position.y + NODE_SIZE.h / 2 - cz) * SCALE,
    );

  const disposables: { dispose(): void }[] = [];
  const cards = new Map<THREE.Sprite, ConceptNode>();
  const at = new Map<string, THREE.Vector3>();
  for (const n of graph.nodes) {
    const tex = cardTexture(n, colors, false);
    // Drawn after the translucent plates, so a plate in front never washes a card out.
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 2;
    sprite.scale.set(CARD.w, CARD.h, 1);
    const p = place(n);
    sprite.position.copy(p).add(new THREE.Vector3(0, CARD.h / 2 + 0.05, 0));
    at.set(n.id, p);
    scene.add(sprite);
    cards.set(sprite, n);
    disposables.push(tex, mat);
  }

  // Plates: one per layer, spanning the whole graph's footprint so they read as a stack.
  const xs = [...at.values()].map((p) => p.x);
  const zs = [...at.values()].map((p) => p.z);
  const span = { x: Math.max(...xs, 0) - Math.min(...xs, 0) + CARD.w + 2, z: Math.max(...zs, 0) - Math.min(...zs, 0) + 2 };
  const mid = { x: (Math.max(...xs, 0) + Math.min(...xs, 0)) / 2, z: (Math.max(...zs, 0) + Math.min(...zs, 0)) / 2 };
  const plateGeo = new THREE.PlaneGeometry(span.x, span.z);
  const edgeGeo = new THREE.EdgesGeometry(plateGeo);
  disposables.push(plateGeo, edgeGeo);
  for (let l = 0; l <= depth; l++) {
    const y = (depth - l - depth / 2) * STOREY;
    const mat = new THREE.MeshBasicMaterial({ color: colors.accentSoft, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    const plate = new THREE.Mesh(plateGeo, mat);
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(mid.x, y, mid.z);
    scene.add(plate);
    const lineMat = new THREE.LineBasicMaterial({ color: colors.accent, transparent: true, opacity: 0.35 });
    const outline = new THREE.LineSegments(edgeGeo, lineMat);
    outline.rotation.x = -Math.PI / 2;
    outline.position.copy(plate.position);
    scene.add(outline);
    const label = labelSprite(opts.labels.layer(l), colors.accent);
    label.position.set(mid.x - span.x / 2 + label.scale.x / 2 + 0.2, y + 0.3, mid.z + span.z / 2 - 0.3);
    scene.add(label);
    disposables.push(mat, lineMat, label.material, label.material.map!);
  }

  // Relations: dependency links in the accent colour, the others in the edge colour.
  const deps = new Map(graph.nodes.map((n) => [n.id, new Set(n.dependsOn)]));
  const points: Record<"dep" | "rel", number[]> = { dep: [], rel: [] };
  for (const r of graph.relations) {
    const a = at.get(r.a);
    const b = at.get(r.b);
    if (!a || !b || r.a === r.b) continue;
    const dep = deps.get(r.a)?.has(r.b) || deps.get(r.b)?.has(r.a);
    points[dep ? "dep" : "rel"].push(a.x, a.y + 0.05, a.z, b.x, b.y + 0.05, b.z);
  }
  for (const [kind, list] of Object.entries(points)) {
    if (!list.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(list, 3));
    const mat = new THREE.LineBasicMaterial({ color: kind === "dep" ? colors.accent : colors.edge, transparent: true, opacity: kind === "dep" ? 0.8 : 0.55 });
    scene.add(new THREE.LineSegments(geo, mat));
    disposables.push(geo, mat);
  }

  // Camera: from above and to the side, far enough to see the whole stack.
  const radius = Math.max(span.x, span.z, (depth + 1) * STOREY) * 0.95 + 3;
  const home = new THREE.Vector3(radius * 0.8, radius * 0.55, radius * 0.9);
  const resetView = () => {
    camera.position.copy(home);
    controls.target.set(mid.x, 0, mid.z);
    controls.update();
  };
  resetView();

  // Picking: a click (not a drag) on a card opens it; hovering highlights it.
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const hit = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const found = ray.intersectObjects([...cards.keys()], false)[0];
    return found ? (found.object as THREE.Sprite) : null;
  };
  let hovered: THREE.Sprite | null = null;
  const hoverTex = new Map<THREE.Sprite, THREE.CanvasTexture>();
  const setHover = (s: THREE.Sprite | null) => {
    if (s === hovered) return;
    for (const [sprite, n] of cards) {
      const mat = sprite.material as THREE.SpriteMaterial;
      if (sprite === s) {
        let tex = hoverTex.get(sprite);
        if (!tex) {
          tex = cardTexture(n, colors, true);
          hoverTex.set(sprite, tex);
          disposables.push(tex);
          sprite.userData.plain = mat.map;
        }
        mat.map = tex;
      } else if (sprite.userData.plain) mat.map = sprite.userData.plain as THREE.Texture;
      mat.needsUpdate = true;
    }
    hovered = s;
    canvas.style.cursor = s ? "pointer" : "grab";
    opts.onHover(s ? cards.get(s)!.name : null);
  };
  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
  const onUp = (e: PointerEvent) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
      const s = hit(e);
      if (s) opts.onPick(cards.get(s)!.id);
    }
    down = null;
  };
  const onMove = (e: PointerEvent) => {
    if (!down) setHover(hit(e));
  };
  const onLeave = () => setHover(null);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);

  // Size with the container.
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  let frame = 0;
  const loop = () => {
    controls.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(loop);
  };
  loop();

  const spherical = new THREE.Spherical();
  return {
    resetView,
    rotate(dx, dy) {
      stopSpin();
      const offset = camera.position.clone().sub(controls.target);
      spherical.setFromVector3(offset);
      spherical.theta += dx;
      spherical.phi = Math.min(Math.PI - 0.05, Math.max(0.05, spherical.phi + dy));
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      controls.update();
    },
    zoom(factor) {
      stopSpin();
      const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
      camera.position.copy(controls.target).add(offset);
      controls.update();
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", stopSpin);
      canvas.removeEventListener("wheel", stopSpin);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
    },
  };
}
