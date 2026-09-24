import { getJson, type LookupOptions } from "./http";

/** A Lean 4 declaration in Mathlib (or Lean core), as Loogle reports it. */
export interface LeanDecl {
  name: string;
  /** Its type (signature), as Lean prints it. */
  type: string;
  module: string;
  doc?: string;
}

const LOOGLE = "https://loogle.lean-lang.org/json";

/** Link to a declaration in the Mathlib documentation. */
export const mathlibDocUrl = (d: Pick<LeanDecl, "name" | "module">) =>
  `https://leanprover-community.github.io/mathlib4_docs/${d.module.split(".").join("/")}.html#${encodeURIComponent(d.name)}`;

/**
 * The Lean 4 web editor (live.lean-lang.org, whose default project has Mathlib) opened on `import Mathlib` and
 * `#check <name>`, to try the declaration out.
 */
export const leanEditorUrl = (name: string) =>
  `https://live.lean-lang.org/#code=${encodeURIComponent(`import Mathlib\n\n#check ${name}\n`)}`;

/** Loogle's search page for a query (for "search yourself" links). */
export const loogleSearchUrl = (q: string) => `https://loogle.lean-lang.org/?q=${encodeURIComponent(q)}`;

/** A plausible fully qualified Lean name: dotted identifiers, no spaces or query syntax. */
export const isLeanName = (s: string) => /^[\p{L}_][\p{L}\p{N}_'!?₀-₉]*(\.[\p{L}_][\p{L}\p{N}_'!?₀-₉]*)*$/u.test(s.trim());

/**
 * Does Mathlib have a declaration of exactly this name? Loogle answers an identifier query with the declarations
 * mentioning it, the declaration itself first; an unknown name is an error, i.e. `null` here.
 */
export async function loogleDeclaration(name: string, opts: LookupOptions = {}): Promise<LeanDecl | null> {
  const q = name.trim();
  if (!isLeanName(q)) return null;
  const r = await getJson<{ error?: string; hits?: { name: string; type: string; module: string; doc?: string | null }[] }>(
    "Loogle",
    `${LOOGLE}?${new URLSearchParams({ q })}`,
    opts,
  );
  const hit = r?.hits?.find((h) => h.name === q);
  if (!hit) return null;
  // Within what a stored result may hold (FormalDecl), so it survives export and import.
  const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  const doc = hit.doc?.trim();
  return { name: hit.name, type: cut(hit.type.trim(), 4000), module: hit.module, ...(doc ? { doc: cut(doc, 4000) } : {}) };
}
