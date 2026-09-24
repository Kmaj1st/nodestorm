import { describe, expect, it } from "vitest";
import { buildIndex, chunkPages, search, tokenize, topChunks, type Chunk } from "../src/lib/retrieve";

const sentence = (i: number) => `Sentence number ${i} talks about topic${i} in some detail.`;

describe("chunkPages", () => {
  it("keeps short pages whole, with their page numbers, and skips empty ones", () => {
    const chunks = chunkPages("d1", "Notes", [
      { page: 1, text: "A group is a set with an operation." },
      { page: 2, text: "  \n\n " },
      { page: 3, text: "A ring has two operations.\n\nA field is a ring." },
    ]);
    expect(chunks).toEqual([
      { docId: "d1", title: "Notes", page: 1, text: "A group is a set with an operation." },
      { docId: "d1", title: "Notes", page: 3, text: "A ring has two operations.\n\nA field is a ring." },
    ]);
  });

  it("respects the size, breaks between sentences and overlaps consecutive chunks", () => {
    const text = Array.from({ length: 40 }, (_, i) => sentence(i)).join(" ");
    const chunks = chunkPages("d", "T", [{ page: 7, text }], 300, 80);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      expect(c.page).toBe(7);
      expect(c.text.length).toBeLessThanOrEqual(300);
      expect(c.text).toMatch(/\.$/); // ends at a sentence end
    }
    // Every sentence is somewhere, and each chunk after the first starts with the end of the one before.
    for (let i = 0; i < 40; i++) expect(chunks.some((c) => c.text.includes(sentence(i)))).toBe(true);
    for (let i = 1; i < chunks.length; i++) {
      const head = chunks[i].text.slice(0, 20);
      expect(chunks[i - 1].text).toContain(head);
    }
  });

  it("never spans pages and splits text without spaces hard", () => {
    const chunks = chunkPages("d", "T", [
      { page: 1, text: "群".repeat(250) },
      { page: 2, text: "short" },
    ], 100, 20);
    expect(chunks.map((c) => c.page)).toEqual([1, 1, 1, 1, 2]);
    expect(chunks[1].text).toBe("群".repeat(99)); // 20 characters of overlap, and no space put into the text
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(100);
    // No overlap still covers everything exactly once.
    const plain = chunkPages("d", "T", [{ page: 1, text: "群".repeat(250) }], 100, 0);
    expect(plain.map((c) => c.text).join("")).toBe("群".repeat(250));
  });

  it("keeps line and paragraph breaks inside a chunk", () => {
    const [c] = chunkPages("d", "T", [{ page: 1, text: "Title\n1. First item.\n2. Second item.\n\nNext paragraph." }]);
    expect(c.text).toBe("Title\n1. First item.\n2. Second item.\n\nNext paragraph.");
  });
});

describe("tokenize", () => {
  it("lowercases words of any alphabet and drops stopwords and one-letter Latin words", () => {
    expect(tokenize("The kernel of a Homomorphism φ: G → H")).toEqual(["kernel", "homomorphism", "φ"]);
    expect(tokenize("Ядро гомоморфизма")).toEqual(["ядро", "гомоморфизма"]);
    expect(tokenize("Problem sheet 3")).toEqual(["problem", "sheet", "3"]);
  });

  it("turns LaTeX commands into words", () => {
    expect(tokenize("$\\ker\\phi \\trianglelefteq G$")).toEqual(["ker", "phi", "trianglelefteq"]);
    expect(tokenize("\\operatorname{im}(f)")).toEqual(["operatorname", "im"]);
  });

  it("splits Chinese, Japanese and Korean runs into overlapping pairs", () => {
    expect(tokenize("同态的核")).toEqual(["同态", "态的", "的核"]);
    expect(tokenize("核")).toEqual(["核"]);
    expect(tokenize("準同型写像の核")).toEqual(["準同", "同型", "型写", "写像", "像の", "の核"]);
    expect(tokenize("동형 사상")).toEqual(["동형", "사상"]);
    // Mixed runs: the Latin and CJK parts are handled separately.
    expect(tokenize("群G的kernel")).toEqual(["群", "的", "kernel"]);
  });

  it("gives nothing for empty or symbol-only text", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("  = + ( ) → ")).toEqual([]);
  });
});

describe("search", () => {
  const chunk = (page: number, text: string): Chunk => ({ docId: "d", title: "Algebra", page, text });
  const chunks = [
    chunk(1, "A group is a set with an associative operation, an identity and inverses."),
    chunk(2, "The kernel of a homomorphism is the set of elements mapped to the identity. The kernel is a normal subgroup."),
    chunk(3, "The image of a homomorphism is a subgroup of the codomain."),
    chunk(4, "A ring is an abelian group with a second, distributive operation."),
    chunk(5, "同态的核是正规子群。"),
  ];

  it("ranks the relevant chunk first", () => {
    const hits = topChunks(chunks, "Show that the kernel of a homomorphism is normal");
    expect(hits[0].chunk.page).toBe(2);
    expect(hits.map((h) => h.chunk.page)).toContain(3); // shares "homomorphism"
    expect(hits.every((h) => h.score > 0)).toBe(true);
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
  });

  it("finds CJK text by bigrams", () => {
    expect(topChunks(chunks, "核是正规子群吗？")[0].chunk.page).toBe(5);
  });

  it("returns [] for an empty, stopword-only or unmatched query", () => {
    const index = buildIndex(chunks);
    expect(search(index, "")).toEqual([]);
    expect(search(index, "the of and")).toEqual([]);
    expect(search(index, "topology")).toEqual([]);
    expect(search(buildIndex([]), "kernel")).toEqual([]);
    expect(search(index, "kernel", 0)).toEqual([]);
  });

  it("limits to k results and keeps chunk order on ties", () => {
    const same = [1, 2, 3, 4].map((p) => chunk(p, "subgroup lemma"));
    const hits = search(buildIndex(same), "subgroup", 3);
    expect(hits.map((h) => h.chunk.page)).toEqual([1, 2, 3]);
  });
});

describe("chunkPages with CJK sentences", () => {
  it("puts no spaces between sentences that had none", () => {
    const [c] = chunkPages("d", "T", [{ page: 1, text: "同态的核是正规子群。像是子群。" }]);
    expect(c.text).toBe("同态的核是正规子群。像是子群。");
  });
});
