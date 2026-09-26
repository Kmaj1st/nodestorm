import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

/**
 * Reading imported PDFs for "Derive together": the text of every page, and a page picture for pages without a text
 * layer (scans), which can then be read by a vision model. PDF.js is loaded on first use with a dynamic import, so
 * it and its worker are their own chunks and the main bundle never carries them. Only `import type` from pdfjs-dist
 * at the top of this file: a value import would pull it into the main chunk.
 */

export interface PdfPage {
  /** 1-based page number. */
  page: number;
  /** The page's text, whitespace normalised; lines kept as newlines. Empty for a page without a text layer. */
  text: string;
  /** Too little text to be a real text page: probably a scan (see `looksScanned`). */
  scanned: boolean;
}

/** An open PDF. Keep it to render page pictures, and `destroy()` it when done (it holds the worker's copy). */
export interface PdfHandle {
  readonly numPages: number;
  destroy(): Promise<void>;
  /** The PDF.js document, for this module only. */
  readonly doc: PDFDocumentProxy;
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type TextItems = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>["items"];

let loading: Promise<PdfJs> | null = null;

/** PDF.js with its worker configured, loaded once. A failed load (offline, stale chunk) is retried next time. */
function pdfjs(): Promise<PdfJs> {
  if (loading) return loading;
  // The legacy build: the modern one relies on very new JavaScript (e.g. Map.prototype.getOrInsertComputed) that
  // many browsers still in use don't have, and fails there only once a page is drawn.
  loading = Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  loading.catch(() => { loading = null; });
  return loading;
}

/** Fewer than this many non-whitespace characters on a page: treat it as a scan (page numbers, a stray header). */
const SCANNED_BELOW = 40;

/**
 * Does a page look like a scan with no (useful) text layer? A page with no text at all does; one with only a little
 * text (a page number, a header) does when it also has a picture. A short page of real text (one exercise) doesn't.
 */
export function looksScanned(text: string, hasImage = true): boolean {
  const chars = text.replace(/\s+/g, "").length;
  return chars === 0 || (chars < SCANNED_BELOW && hasImage);
}

/**
 * Page text from PDF.js text items. Items are joined with spaces and `hasEOL` becomes a newline; then runs of
 * spaces collapse to one, spaces around newlines go, and more than one blank line becomes one. Marked-content
 * items (no `str`) are skipped.
 */
export function textFromItems(items: TextItems): string {
  let out = "";
  for (const item of items) {
    if (!("str" in item)) continue;
    out += item.str + (item.hasEOL ? "\n" : " ");
  }
  return out
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Does the page paint a picture (as a scan does)? */
async function hasImage(lib: PdfJs, page: PDFPageProxy): Promise<boolean> {
  const { OPS } = lib;
  const painting = new Set<number>([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]);
  try {
    return (await page.getOperatorList()).fnArray.some((f) => painting.has(f));
  } catch {
    return true; // can't tell: treat it as a picture, so the page is offered to the vision model
  }
}

const aborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The import was cancelled", "AbortError");
};

/**
 * Open a PDF and extract the text of every page. `onPage(done, total)` reports progress after each page. With an
 * aborted `signal` the document is destroyed and the promise rejects with the signal's reason. PDF.js takes
 * ownership of the bytes it is given, so it gets a copy: `data` stays usable by the caller.
 */
export async function readPdf(
  data: ArrayBuffer,
  opts: { signal?: AbortSignal; onPage?: (done: number, total: number) => void } = {},
): Promise<{ pages: PdfPage[]; doc: PdfHandle }> {
  const { signal, onPage } = opts;
  aborted(signal);
  const lib = await pdfjs();
  aborted(signal);
  // Files are untrusted: no XFA forms. PDF scripts never run here (only PDF.js's viewer, not used, has a scripting
  // sandbox), and the production build's CSP (pwa/csp.ts) forbids eval and inline code besides.
  const task = lib.getDocument({ data: new Uint8Array(data.slice(0)), verbosity: lib.VerbosityLevel.ERRORS, enableXfa: false });
  const stop = () => void task.destroy();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const doc = await task.promise;
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      aborted(signal);
      const page = await doc.getPage(n);
      const text = textFromItems((await page.getTextContent()).items);
      // Only a page with little text needs the (slower) check for pictures.
      const scanned = looksScanned(text) && looksScanned(text, await hasImage(lib, page));
      page.cleanup();
      pages.push({ page: n, text, scanned });
      onPage?.(n, doc.numPages);
    }
    aborted(signal);
    return { pages, doc: { numPages: doc.numPages, destroy: () => task.destroy(), doc } };
  } catch (e) {
    await task.destroy().catch(() => {});
    aborted(signal); // a cancelled import reports the cancellation, not whatever PDF.js threw on the way out
    throw e;
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}

/** Base64 of a blob's bytes, without the `data:` prefix. */
async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Render scale before the size cap: ~108 dpi, enough for a vision model to read ordinary print. */
const SCALE = 1.5;
const JPEG_QUALITY = 0.85;

/**
 * A JPEG of one page (1-based), at 1.5× its PDF size but with the longest side at most `maxSide` pixels, on a white
 * background. Uses an OffscreenCanvas where there is one, else a detached `<canvas>`. `data` is plain base64.
 */
export async function renderPageImage(
  handle: PdfHandle,
  page: number,
  maxSide = 1600,
): Promise<{ mediaType: "image/jpeg"; data: string }> {
  const p = await handle.doc.getPage(page);
  try {
    const base = p.getViewport({ scale: 1 });
    const scale = Math.min(SCALE, maxSide / Math.max(base.width, base.height));
    const viewport = p.getViewport({ scale });
    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D is not available");
      // PDF.js types only name <canvas>; given the context itself (and `canvas: null`) it draws on any 2D context.
      await p.render({ canvas: null, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport, background: "#fff" })
        .promise;
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
      return { mediaType: "image/jpeg", data: await blobBase64(blob) };
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    await p.render({ canvas, viewport, background: "#fff" }).promise;
    const url = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return { mediaType: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
  } finally {
    p.cleanup();
  }
}

/** A document title from a file name: no extension, underscores as spaces, whitespace tidied. */
export function titleFromFile(name: string): string {
  const base = name.replace(/^.*[\\/]/, "");
  const stem = base.replace(/\.[^.]+$/, "") || base;
  return stem.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
}
