import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// The app uses PDF.js's legacy build, which runs its worker in-process ("fake worker") under Node. The ?url worker
// import becomes the unminified worker's path, which is what the fake worker imports.
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({
  default: fileURLToPath(new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url)),
}));

import { looksScanned, readPdf, textFromItems, titleFromFile } from "../src/lib/pdf";

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

describe("readPdf (fixtures)", () => {
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
});
