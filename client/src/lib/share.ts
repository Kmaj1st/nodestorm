import type { Graph } from "@nodestorm/shared";
import { t } from "../i18n";
import { repairImport } from "./importRepair";

/**
 * Share a graph by link, without a server: the graph is packed into compact JSON, deflate-compressed and
 * base64url-encoded into the URL hash (`#share=1.<data>`). Browsers never send the hash to the server, so the
 * graph only travels inside the link itself. Decoding validates and repairs like a file import.
 */

export const SHARE_HASH = "#share=";
/** Format version, the first part of the token. Bump it when the packing changes. */
const VERSION = "1";
/** Links longer than this may get cut off by chat apps and mail clients; the share dialog warns about it. */
export const LONG_LINK = 8000;
/** Refuse tokens longer than this before decoding anything. */
export const MAX_TOKEN_CHARS = 500_000;
/** Cap on the decompressed JSON, so a tiny "zip bomb" link can't expand into gigabytes. */
export const MAX_JSON_BYTES = 5 * 1024 * 1024;

/** A link that can't be opened. The message is meant for the user. */
export class ShareError extends Error {}

const damaged = () => new ShareError(t("share.damaged"));

export interface CodecOptions {
  /** Use the browser's CompressionStream (default). False forces the pure-JS fallback (tests). */
  native?: boolean;
  /** Override MAX_JSON_BYTES (tests). */
  maxBytes?: number;
}

/**
 * The shared form of a graph: a nodestorm/v1 file (so import repair can read it) with everything a viewer
 * doesn't need left out. Node ids become short indexes, empty fields and relation ids are dropped (import fills
 * them in), positions are rounded, and AI state that can't travel (running or failed checks) is settled.
 */
export function packGraph(g: Graph, name: string): unknown {
  const ids = new Map(g.nodes.map((n, i) => [n.id, i.toString(36)]));
  // Quiz mastery, notes, explanations and theorem anatomies are deliberately left out: they are the sender's own study progress and
  // notebook rather than part of the graph, and whoever saves a copy starts their own quiz from scratch. Stored lookups
  // (Mathlib declarations, papers) are bulky and can be fetched again, so they stay out too.
  const nodes = g.nodes.map((n) => {
    // A check that's running or failed here can't be resumed by the viewer: show what's known. Without missing
    // prerequisites that is "not checked" (or "needs a definition"), never "ok", which would claim the check passed.
    const settled = n.missingDeps.length ? "blocked" : n.definition.trim() ? "pending" : "unclear";
    const status = n.status === "checking" || n.status === "error" ? settled : n.status;
    const out: Record<string, unknown> = {
      id: ids.get(n.id),
      name: n.name,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    };
    if (n.definition) out.definition = n.definition;
    if (n.aliases.length) out.aliases = n.aliases;
    if (status !== "ok") out.status = status;
    const deps = n.dependsOn.filter((d) => ids.has(d)).map((d) => ids.get(d));
    if (deps.length) out.dependsOn = deps;
    if (n.missingDeps.length) out.missingDeps = n.missingDeps.map((d) => ({ name: d.name, reason: d.reason, role: d.role }));
    if (status === "unclear" && n.senses?.length) out.senses = n.senses;
    if (n.source) out.source = n.source;
    if (n.kind) out.kind = n.kind;
    if (n.kindByUser) out.kindByUser = true;
    if (n.pinned) out.pinned = true;
    if (n.basic) out.basic = true;
    return out;
  });
  const dir = (d: { kind: string; explanation: string }) => (d.explanation ? { kind: d.kind, explanation: d.explanation } : { kind: d.kind });
  const relations = g.relations
    .filter((r) => ids.has(r.a) && ids.has(r.b))
    .map((r) => ({
      a: ids.get(r.a),
      b: ids.get(r.b),
      aToB: dir(r.aToB),
      bToA: dir(r.bToA),
      ...(r.origin !== "mix" ? { origin: r.origin } : {}),
    }));
  // A shared sandbox becomes a graph of its own.
  return { format: "nodestorm/v1", project: { name }, graphs: [{ name: g.parentId ? "Main" : g.name, nodes, relations }] };
}

/** The token that goes after `#share=`. */
export async function encodeShare(g: Graph, name: string, opts: CodecOptions = {}): Promise<string> {
  const json = JSON.stringify(packGraph(g, name));
  return `${VERSION}.${toBase64Url(await deflate(new TextEncoder().encode(json), opts.native ?? true))}`;
}

/** A full link to this page that opens `token`. */
export function shareUrl(token: string, loc: Pick<Location, "origin" | "pathname" | "search"> = location): string {
  return `${loc.origin}${loc.pathname}${loc.search}${SHARE_HASH}${token}`;
}

/** The share token in a URL hash, or null when the hash isn't a share link. */
export function shareToken(hash: string): string | null {
  return hash.startsWith(SHARE_HASH) ? hash.slice(SHARE_HASH.length).trim() : null;
}

export interface SharedGraph {
  graph: Graph;
  /** The project name the sender shared it under. */
  name: string;
  /** What import repair had to fix (see importRepair.ts). */
  fixes: string[];
}

/** Decode, validate and repair a share token. Throws ShareError with a message for the user. */
export async function decodeShare(token: string, opts: CodecOptions = {}): Promise<SharedGraph> {
  if (token.length > MAX_TOKEN_CHARS) throw new ShareError(t("share.tooLarge"));
  const dot = token.indexOf(".");
  if (dot < 0) throw damaged();
  if (token.slice(0, dot) !== VERSION) {
    throw new ShareError(t("share.newer"));
  }
  const max = opts.maxBytes ?? MAX_JSON_BYTES;
  let raw: unknown;
  try {
    const bytes = await inflate(fromBase64Url(token.slice(dot + 1)), opts.native ?? true, max);
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (e) {
    throw e instanceof ShareError ? e : damaged();
  }
  let repaired: ReturnType<typeof repairImport>;
  try {
    repaired = repairImport(raw);
  } catch {
    throw new ShareError(t("share.notGraph"));
  }
  const { doc, fixes } = repaired;
  // Only the first graph is shown; a hand-made link can't smuggle in sandboxes.
  const { parentId: _p, forkedAt: _f, ...graph } = doc.graphs[0];
  return { graph, name: doc.project?.name || graph.name || t("share.defaultName"), fixes };
}

// ---------- compression ----------

/** Raw deflate: the browser's CompressionStream where it exists, else fflate (loaded only then). */
async function deflate(data: Uint8Array<ArrayBuffer>, native: boolean): Promise<Uint8Array> {
  if (native && typeof CompressionStream !== "undefined") {
    try {
      const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // Browsers from before "deflate-raw" was added throw on the format name; use the fallback.
    }
  }
  const { deflateSync } = await import("fflate");
  return deflateSync(data, { level: 9 });
}

/** Raw inflate that stops as soon as the output passes `max` bytes. */
async function inflate(data: Uint8Array<ArrayBuffer>, native: boolean, max: number): Promise<Uint8Array> {
  const tooBig = () => new ShareError(t("share.expandsTooMuch"));
  const chunks: Uint8Array[] = [];
  let total = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  if (native && typeof DecompressionStream !== "undefined") {
    try {
      reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    } catch {
      // No "deflate-raw" in this browser: fall through to fflate.
    }
  }
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        void reader.cancel().catch(() => {});
        throw tooBig();
      }
      chunks.push(value);
    }
  } else {
    const { Inflate } = await import("fflate");
    let over = false;
    const inf = new Inflate((chunk) => {
      total += chunk.length;
      if (total > max) over = true;
      else chunks.push(chunk);
    });
    // Small input slices bound how far one push can overshoot the cap (deflate expands at most ~1000×).
    const SLICE = 1024;
    if (!data.length) inf.push(data, true);
    for (let i = 0; i < data.length && !over; i += SLICE) inf.push(data.subarray(i, i + SLICE), i + SLICE >= data.length);
    if (over) throw tooBig();
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// ---------- base64url ----------

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  // In slices: spreading a huge array into fromCharCode overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw damaged();
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
