import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The app uses PDF.js's legacy build, which runs its worker in-process ("fake worker") under Node. The ?url worker
// import becomes the unminified worker's path, which is what the fake worker imports. It is resolved like any other
// import, so it doesn't matter whether npm installed pdfjs-dist under client/ or at the repo root.
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", async () => {
  const { createRequire } = await import("node:module");
  return { default: createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.worker.mjs") };
});
// The WebAssembly decoders are fetched by URL; Node's fetch reads data: URLs, so each becomes one of its own bytes.
const wasmDataUrl = async (name: string) => {
  const [{ createRequire }, { readFileSync }] = await Promise.all([import("node:module"), import("node:fs")]);
  const bytes = readFileSync(createRequire(import.meta.url).resolve(`pdfjs-dist/wasm/${name}`));
  return { default: `data:application/wasm;base64,${bytes.toString("base64")}` };
};
vi.mock("pdfjs-dist/wasm/jbig2.wasm?url", () => wasmDataUrl("jbig2.wasm"));
vi.mock("pdfjs-dist/wasm/openjpeg.wasm?url", () => wasmDataUrl("openjpeg.wasm"));

import { looksScanned, readPdf, renderPageImage, textFromItems, titleFromFile } from "../src/lib/pdf";

// PDF.js draws with @napi-rs/canvas under Node (its optional dependency); where it isn't installed, the page
// rendering test is skipped.
const napi = await import("@napi-rs/canvas").catch(() => null);

const fixture = (name: string) => {
  const buf = readFileSync(new URL(`../../e2e/fixtures/${name}`, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

describe("looksScanned", () => {
  it("counts non-whitespace characters only", () => {
    expect(looksScanned("")).toBe(true);
    expect(looksScanned("  12 \n\n  ")).toBe(true);
    expect(looksScanned("x".repeat(39) + " \n ".repeat(50))).toBe(true);
    expect(looksScanned("x".repeat(40))).toBe(false);
    // Little text but no picture: a short page of real text, not a scan.
    expect(looksScanned("3. Prove it.", false)).toBe(false);
    expect(looksScanned("", false)).toBe(true);
    expect(looksScanned("Show that the kernel of a homomorphism is normal.")).toBe(false);
  });
});

describe("textFromItems", () => {
  it("joins items with spaces, keeps line ends and tidies whitespace", () => {
    const item = (str: string, hasEOL = false) => ({ str, hasEOL, dir: "ltr", transform: [], width: 0, height: 0, fontName: "F1" });
    const items = [item("Theorem"), item("1."), item("  Let "), item("G", true), item("be a group.", true), item("", true), item("", true), item("Proof", true)];
    expect(textFromItems([...items, { type: "beginMarkedContent" as const, id: "m1" }])).toBe("Theorem 1. Let G\nbe a group.\n\nProof");
  });
});

describe("titleFromFile", () => {
  it("drops the extension and folders and turns underscores into spaces", () => {
    expect(titleFromFile("Problem_sheet_3.pdf")).toBe("Problem sheet 3");
    expect(titleFromFile("C:\\docs\\Dummit__Foote v2.PDF")).toBe("Dummit Foote v2");
    expect(titleFromFile("notes")).toBe("notes");
    expect(titleFromFile(".pdf")).toBe(".pdf");
  });
});

// The first PDF opened loads PDF.js and its fake worker (a few MB of JavaScript to import and compile), which under a
// loaded full run could take longer than a test's 5 s. Pay that once here, with its own time limit, so each test
// below only times its own work. The limit per test is raised too, for machines busy with the other test files.
describe("readPdf (fixtures)", { timeout: 20_000 }, () => {
  beforeAll(async () => {
    const { doc } = await readPdf(fixture("problems.pdf"));
    await doc.destroy();
  }, 60_000);

  it("extracts the text of every page, in order, with progress", async () => {
    const data = fixture("problems.pdf");
    const progress: [number, number][] = [];
    const { pages, doc } = await readPdf(data, { onPage: (done, total) => progress.push([done, total]) });
    try {
      expect(doc.numPages).toBe(2);
      expect(progress).toEqual([[1, 2], [2, 2]]);
      expect(pages).toEqual([
        {
          page: 1,
          text:
            "Problem sheet 3: Homomorphisms\n1. Show that the kernel of a group homomorphism is a normal subgroup.\n" +
            "2. Show that the image of a group homomorphism is a subgroup.",
          scanned: false,
        },
        // Short, but real text and no picture: not a scan.
        { page: 2, text: "3. Prove the First Isomorphism Theorem.", scanned: false },
      ]);
      expect(data.byteLength).toBeGreaterThan(0); // the caller's bytes aren't handed over to PDF.js
    } finally {
      await doc.destroy();
    }
  });

  it("marks a page without a text layer as scanned", async () => {
    const { pages, doc } = await readPdf(fixture("scanned.pdf"));
    await doc.destroy();
    expect(pages).toEqual([{ page: 1, text: "", scanned: true }]);
  });

  it("rejects with the abort reason when cancelled", async () => {
    const ctl = new AbortController();
    const reason = new DOMException("stop", "AbortError");
    const run = readPdf(fixture("problems.pdf"), { signal: ctl.signal, onPage: () => ctl.abort(reason) });
    await expect(run).rejects.toBe(reason);
    ctl.abort();
    await expect(readPdf(fixture("problems.pdf"), { signal: ctl.signal })).rejects.toBe(reason);
  });

  it("rejects on bytes that aren't a PDF", async () => {
    await expect(readPdf(new TextEncoder().encode("not a pdf").buffer as ArrayBuffer)).rejects.toThrow();
  });

  // A black-and-white scan (CCITT fax): PDF.js needs its WebAssembly decoder for it, or the picture is blank.
  it.skipIf(!napi)("renders a fax-compressed scan for the vision model", async () => {
    const { Canvas, createCanvas, loadImage } = napi!;
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        canvas: InstanceType<typeof Canvas>;
        constructor(w: number, h: number) { this.canvas = createCanvas(w, h); }
        getContext(kind: "2d") { return this.canvas.getContext(kind); }
        async convertToBlob({ quality }: { type: string; quality: number }) {
          return new Blob([new Uint8Array(await this.canvas.encode("jpeg", Math.round(quality * 100)))]);
        }
      },
    );
    const { pages, doc } = await readPdf(fixture("scanned-fax.pdf"));
    try {
      expect(pages).toEqual([{ page: 1, text: "", scanned: true }]);
      const image = await renderPageImage(doc, 1);
      expect(image.mediaType).toBe("image/jpeg");
      const img = await loadImage(Buffer.from(image.data, "base64"));
      expect([img.width, img.height]).toEqual([918, 1188]); // US Letter at 1.5×
      const ctx = createCanvas(img.width, img.height).getContext("2d");
      ctx.drawImage(img, 0, 0);
      const grey = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[0];
      expect(grey(459, 594)).toBeLessThan(60); // the bar, in the middle of the page
      expect(grey(175, 180)).toBeGreaterThan(200); // the scan's white margin above it
      expect(grey(20, 20)).toBeGreaterThan(200); // the page's white background
    } finally {
      await doc.destroy();
      vi.unstubAllGlobals();
    }
  });
});
