/**
 * Retrieval for "Derive together": imported documents are cut into page-bound chunks, and BM25 picks the chunks
 * most relevant to the current step, so AI hints can quote and cite them ("Dummit & Foote, p. 12"). Pure and
 * synchronous: an index over a few thousand chunks builds in milliseconds, so it is simply rebuilt when needed.
 */

export interface Chunk {
  docId: string;
  title: string;
  /** 1-based page the text is from. A chunk never spans pages, so the citation is exact. */
  page: number;
  text: string;
}

/** A piece of page text, with the whitespace that separated it from the piece before it. */
interface Piece {
  sep: string;
  text: string;
}

/** Sentence ends: Latin punctuation before whitespace, or CJK full stops (which have no space after them). */
const SENTENCE_END = /(?<=[.!?;:])\s+|(?<=[。！？；])/u;

/**
 * Split text longer than `max` at the last space that fits, or hard at `max` in text without spaces (Chinese,
 * Japanese): then the next piece's separator is "" so no space is put into the text.
 */
function hardSplit(text: string, max: number): Piece[] {
  const out: Piece[] = [];
  let rest = text;
  let sep = " ";
  while (rest.length > max) {
    const cut = rest.lastIndexOf(" ", max);
    const at = cut > max / 2 ? cut : max;
    out.push({ sep, text: rest.slice(0, at).trim() });
    sep = cut > max / 2 ? " " : "";
    rest = rest.slice(at).trim();
  }
  if (rest) out.push({ sep, text: rest });
  return out;
}

/** Page text as paragraphs, then lines, then sentences, each at most `max` characters. */
function pieces(text: string, max: number): Piece[] {
  const out: Piece[] = [];
  text.split(/\n\s*\n/).forEach((para, pi) => {
    para.split("\n").forEach((line, li) => {
      line.split(SENTENCE_END).forEach((sentence, si, all) => {
        // After a CJK full stop the text had no space, so none is added back.
        const after = si > 0 && /[。！？；]$/u.test(all[si - 1]) ? "" : " ";
        hardSplit(sentence.replace(/\s+/g, " ").trim(), max).forEach((part, hi) => {
          if (!part.text) return;
          const sep = hi > 0 ? part.sep : si > 0 ? after : li > 0 ? "\n" : pi > 0 ? "\n\n" : " ";
          out.push({ sep, text: part.text });
        });
      });
    });
  });
  return out;
}

/** The last ~`n` characters of `text`, starting at a word boundary when there is one. */
function tail(text: string, n: number): string {
  if (n <= 0) return "";
  if (text.length <= n) return text;
  const t = text.slice(-n);
  const space = t.search(/\s/);
  return (space >= 0 && /\S/.test(text[text.length - n - 1]) ? t.slice(space + 1) : t).trim();
}

/**
 * Cut pages into chunks of at most `size` characters. Breaks fall between paragraphs, lines or sentences where
 * possible (inside a long sentence at a space, and hard only in text without spaces). Each chunk after the first on
 * a page starts with up to `overlap` characters from the end of the one before, so a statement cut in two is still
 * found whole in one of them (the overlap is capped at half of `size`). Chunks never span pages; empty pages give
 * none.
 */
export function chunkPages(
  docId: string,
  title: string,
  pages: { page: number; text: string }[],
  size = 900,
  overlap = 150,
): Chunk[] {
  size = Math.max(1, Math.floor(size));
  overlap = Math.max(0, Math.min(Math.floor(overlap), Math.floor(size / 2)));
  // A piece must fit after the overlap and its separating space.
  const max = Math.max(1, size - (overlap ? overlap + 1 : 0));
  const chunks: Chunk[] = [];
  for (const { page, text } of pages) {
    let cur = "";
    const push = () => {
      if (cur) chunks.push({ docId, title, page, text: cur });
    };
    for (const p of pieces(text, max)) {
      if (cur && cur.length + p.sep.length + p.text.length > size) {
        push();
        const carried = tail(cur, overlap);
        cur = carried ? carried + (p.sep && " ") + p.text : p.text;
      } else {
        cur = cur ? cur + p.sep + p.text : p.text;
      }
    }
    push();
  }
  return chunks;
}

const STOPWORDS = new Set(
  (
    "a an and are as at be but by for from has have if in into is it its of on or so such that the their then there " +
    "these this those to was we were which will with let show prove"
  ).split(" "),
);

const CJK = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}ー]+/u;
const CJK_SPLIT = /([\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}ー]+)/u;

/**
 * Search terms of a text. Runs of letters and digits (any script) are lowercased words; one-letter Latin words and
 * a few English stopwords (including "show"/"prove", which every exercise has) are dropped. LaTeX needs nothing
 * special: `\ker\phi` gives "ker" and "phi". Chinese, Japanese and Korean runs have no spaces, so they become
 * overlapping character pairs ("同态核" → "同态", "态核"), or the character itself when it stands alone.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const [run] of text.normalize("NFKC").toLowerCase().matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
    for (const part of run.split(CJK_SPLIT)) {
      if (!part) continue;
      if (CJK.test(part)) {
        const chars = [...part];
        if (chars.length === 1) out.push(part);
        for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
      } else if (!(part.length === 1 && /[a-z]/.test(part)) && !STOPWORDS.has(part)) {
        out.push(part);
      }
    }
  }
  return out;
}

/** A BM25 index over chunks (see `buildIndex`). */
export interface Index {
  chunks: Chunk[];
  /** term → [chunk index, term frequency] for every chunk containing it. */
  postings: Map<string, [number, number][]>;
  /** Token count of each chunk. */
  lengths: number[];
  avgLength: number;
}

const K1 = 1.2;
const B = 0.75;

export function buildIndex(chunks: Chunk[]): Index {
  const postings = new Map<string, [number, number][]>();
  const lengths: number[] = [];
  chunks.forEach((c, i) => {
    const terms = tokenize(c.text);
    lengths.push(terms.length);
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, n] of tf) {
      const list = postings.get(t);
      if (list) list.push([i, n]);
      else postings.set(t, [[i, n]]);
    }
  });
  const total = lengths.reduce((a, b) => a + b, 0);
  return { chunks, postings, lengths, avgLength: chunks.length ? total / chunks.length : 0 };
}

/**
 * The `k` chunks that best match `query` by BM25 (k1 = 1.2, b = 0.75, the always-positive idf
 * ln(1 + (N − df + 0.5) / (df + 0.5))), best first. Repeated query terms count once. Chunks sharing no term with
 * the query are left out, so an empty or stopword-only query gives []. Equal scores keep chunk order.
 */
export function search(index: Index, query: string, k = 6): { chunk: Chunk; score: number }[] {
  const n = index.chunks.length;
  if (!n || k <= 0) return [];
  const scores = new Map<number, number>();
  for (const term of new Set(tokenize(query))) {
    const list = index.postings.get(term);
    if (!list) continue;
    const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5));
    for (const [i, tf] of list) {
      const norm = tf + K1 * (1 - B + (B * index.lengths[i]) / (index.avgLength || 1));
      scores.set(i, (scores.get(i) ?? 0) + (idf * tf * (K1 + 1)) / norm);
    }
  }
  return [...scores]
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, k)
    .map(([i, score]) => ({ chunk: index.chunks[i], score }));
}

/** `search` over chunks without keeping the index. */
export const topChunks = (chunks: Chunk[], query: string, k = 6) => search(buildIndex(chunks), query, k);
