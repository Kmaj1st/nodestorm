// Writes the PDF fixtures for the "Derive together" import tests, by hand, with no dependencies:
//   e2e/fixtures/problems.pdf  two pages of text in Helvetica (a problem sheet on homomorphisms)
//   e2e/fixtures/scanned.pdf   one page with only a drawn rectangle, i.e. what a scan without OCR looks like
// The output is deterministic (no dates, no ids), so rerunning it leaves the committed files unchanged.
// Usage: node scripts/make-fixture-pdf.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const out = new URL("../e2e/fixtures/", import.meta.url);

/** A PDF literal string: backslashes and parentheses escaped. ASCII only (Helvetica, WinAnsi). */
const str = (s) => `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;

/** Content stream drawing one line of text per entry: [size, x, y, text]. */
const textStream = (lines) => lines.map(([size, x, y, text]) => `BT /F1 ${size} Tf ${x} ${y} Td ${str(text)} Tj ET`).join("\n");

/**
 * A complete PDF (1.4, US Letter pages) from one content stream per page. Objects: 1 catalog, 2 page tree,
 * 3 font, then a page and its content stream for each page. The xref table holds byte offsets, and every entry
 * is exactly 20 bytes ("0000000015 00000 n" plus a space and a newline), as the spec requires.
 */
function makePdf(pages) {
  const objects = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  pages.forEach((content, i) => {
    const pageId = pageIds[i];
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
  });

  // The binary comment on line 2 tells transfer tools the file isn't plain text.
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const problems = makePdf([
  textStream([
    [18, 72, 720, "Problem sheet 3: Homomorphisms"],
    [12, 72, 680, "1. Show that the kernel of a group homomorphism is a normal subgroup."],
    [12, 72, 656, "2. Show that the image of a group homomorphism is a subgroup."],
  ]),
  textStream([[12, 72, 720, "3. Prove the First Isomorphism Theorem."]]),
]);

// A stroked grey rectangle and nothing else: no text layer at all.
const scanned = makePdf(["0.4 0.4 0.4 RG 2 w 100 300 412 300 re S"]);

mkdirSync(out, { recursive: true });
writeFileSync(new URL("problems.pdf", out), problems);
writeFileSync(new URL("scanned.pdf", out), scanned);
console.log(`wrote e2e/fixtures/problems.pdf (${problems.length} bytes) and e2e/fixtures/scanned.pdf (${scanned.length} bytes)`);
