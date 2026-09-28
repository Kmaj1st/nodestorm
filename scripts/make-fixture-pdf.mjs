// Writes the PDF fixtures for the "Derive together" import tests, by hand, with no dependencies:
//   e2e/fixtures/problems.pdf  two pages of text in Helvetica (a problem sheet on homomorphisms)
//   e2e/fixtures/scanned.pdf   one page with only a drawn rectangle, i.e. what a scan without OCR looks like
//   e2e/fixtures/scanned-fax.pdf  one page that is a CCITT Group 4 (fax) picture, as black-and-white scanners write
//                                 them: a black bar on white. PDF.js decodes these (and JBIG2) with WebAssembly.
//   e2e/fixtures/cjk.pdf       one line of Chinese in STSong-Light, not embedded, with the predefined CMap
//                              UniGB-UCS2-H (as many Chinese papers and textbooks are written): its text can only be
//                              read with PDF.js's CMaps (UniGB-UCS2-H to CIDs, Adobe-GB1-UCS2 back to Unicode).
// The output is deterministic (no dates, no ids), so rerunning it leaves the committed files unchanged.
// Usage: node scripts/make-fixture-pdf.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const out = new URL("../e2e/fixtures/", import.meta.url);

/** A PDF literal string: backslashes and parentheses escaped. ASCII only (Helvetica, WinAnsi). */
const str = (s) => `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;

/** Content stream drawing one line of text per entry: [size, x, y, text]. */
const textStream = (lines) => lines.map(([size, x, y, text]) => `BT /F1 ${size} Tf ${x} ${y} Td ${str(text)} Tj ET`).join("\n");

const HELVETICA = { dict: () => "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", extra: [] };

/**
 * A complete PDF (1.4, US Letter pages) from one content stream per page. Objects: 1 catalog, 2 page tree,
 * 3 font `/F1`, then a page and its content stream for each page, then `image` if given (an image XObject `/Im1`
 * every page can draw: its dictionary entries and its bytes), then the font's `extra` objects (`font.dict(id)` gets
 * the id of the first of them). The xref table holds byte offsets, and every entry is exactly 20 bytes
 * ("0000000015 00000 n" plus a space and a newline), as the spec requires.
 */
function makePdf(pages, image, font = HELVETICA) {
  const objects = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  const imageId = 4 + pages.length * 2;
  const xobject = image ? ` /XObject << /Im1 ${imageId} 0 R >>` : "";
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  const extraId = imageId + (image ? 1 : 0);
  objects[3] = font.dict(extraId);
  font.extra.forEach((obj, i) => { objects[extraId + i] = obj(extraId); });
  pages.forEach((content, i) => {
    const pageId = pageIds[i];
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >>${xobject} >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
  });
  if (image) {
    const bytes = image.data.toString("latin1");
    objects[imageId] = `<< /Type /XObject /Subtype /Image ${image.dict} /Length ${bytes.length} >>\nstream\n${bytes}\nendstream`;
  }

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

// A 64 × 32 picture, white with a black bar from (8, 8) to (55, 23), CCITT Group 4 encoded (made once with Pillow:
// Image.new("1", (64, 32), 1), the rectangle filled with 0, saved as a group4 TIFF; these are its one strip's bytes,
// which code black as 1, hence /BlackIs1). Drawn 400 × 200 pt at (106, 296), so the bar covers the middle of the page.
const scannedFax = makePdf(["q 400 0 0 200 106 296 cm /Im1 Do Q"], {
  dict: "/Width 64 /Height 32 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns 64 /Rows 32 /BlackIs1 true >>",
  data: Buffer.from("26a0786ffffc8a17fffffffffffffff8ffff001001", "hex"),
});

// A Type0 font that is only named, not embedded: STSong-Light (one of the Adobe-GB1 fonts every PDF reader is
// expected to supply), with the predefined CMap UniGB-UCS2-H, so the text is written as UCS-2 codes. Object `id` is
// its CIDFont, `id + 1` the descriptor. No /ToUnicode: the reader maps codes to CIDs and CIDs back to Unicode with
// the predefined CMaps.
const CJK_TEXT = "群论：正规子群与商群";
const stSong = {
  dict: (id) => `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${id} 0 R] >>`,
  extra: [
    (id) =>
      `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor ${id + 1} 0 R /DW 1000 >>`,
    () =>
      "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>",
  ],
};
const ucs2 = (s) => `<${[...s].map((c) => c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join("")}>`;
const cjk = makePdf([`BT /F1 24 Tf 72 700 Td ${ucs2(CJK_TEXT)} Tj ET`], undefined, stSong);

mkdirSync(out, { recursive: true });
writeFileSync(new URL("problems.pdf", out), problems);
writeFileSync(new URL("scanned.pdf", out), scanned);
writeFileSync(new URL("scanned-fax.pdf", out), scannedFax);
writeFileSync(new URL("cjk.pdf", out), cjk);
console.log(
  `wrote e2e/fixtures/problems.pdf (${problems.length} bytes), scanned.pdf (${scanned.length} bytes), scanned-fax.pdf (${scannedFax.length} bytes) and cjk.pdf (${cjk.length} bytes)`,
);
