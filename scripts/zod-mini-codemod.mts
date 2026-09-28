// Rewrites zod schemas from the classic method API (`z.string().trim().max(9).optional()`) to zod/mini's functional
// one (`z.optional(z.string().check(z.trim(), z.maxLength(9)))`), which bundlers can tree-shake: the classic API
// carries every method of every schema (and JSON Schema output) into the main chunk. Kept so a branch that still
// writes the classic API can be converted the same way when it is merged.
// Usage: npx tsx scripts/zod-mini-codemod.mts <file.ts>...   (rewrites the files in place; review the diff)
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const files = process.argv.slice(2);
const program = ts.createProgram(files, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
});
const checker = program.getTypeChecker();

/** The classic schema class of an expression's type ("ZodString", "ZodArray"…), or null if it isn't a schema. */
function zodClass(node: ts.Node): string | null {
  const t = checker.getTypeAtLocation(node);
  const name = t.getSymbol()?.getName() ?? t.aliasSymbol?.getName() ?? "";
  return /^Zod[A-Z]/.test(name) ? name : null;
}

/** A schema expression being rewritten: its text, plus the checks to append as one `.check(…)`. */
type Out = { base: string; checks: string[] };
const render = (o: Out) => (o.checks.length ? `${o.base}.check(${o.checks.join(", ")})` : o.base);

const WRAPPERS: Record<string, (r: string, a: string[]) => string> = {
  optional: (r) => `z.optional(${r})`,
  nullable: (r) => `z.nullable(${r})`,
  nullish: (r) => `z.nullish(${r})`,
  default: (r, a) => `z._default(${r}, ${a.join(", ")})`,
  catch: (r, a) => `z.catch(${r}, ${a.join(", ")})`,
  array: (r) => `z.array(${r})`,
  extend: (r, a) => `z.extend(${r}, ${a.join(", ")})`,
  transform: (r, a) => `z.pipe(${r}, z.transform(${a.join(", ")}))`,
};

function checkFor(method: string, cls: string, args: string[]): string | null {
  const num = cls === "ZodNumber";
  switch (method) {
    case "min": return `z.${num ? "minimum" : "minLength"}(${args.join(", ")})`;
    case "max": return `z.${num ? "maximum" : "maxLength"}(${args.join(", ")})`;
    case "int": return `z.int(${args.join(", ")})`;
    case "trim": return "z.trim()";
    case "toLowerCase": return "z.toLowerCase()";
    case "regex": return `z.regex(${args.join(", ")})`;
    case "refine": return `z.refine(${args.join(", ")})`;
    default: return null;
  }
}

function convert(sf: ts.SourceFile): string {
  const text = sf.text;
  /** The node's text with its converted children spliced in. */
  function generic(node: ts.Node): string {
    let out = "";
    let pos = node.getStart(sf);
    node.forEachChild((child) => {
      const start = child.getStart(sf);
      out += text.slice(pos, start) + emit(child);
      pos = child.getEnd();
    });
    return out + text.slice(pos, node.getEnd());
  }
  function chain(node: ts.Expression): Out {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const recv = node.expression.expression;
      const method = node.expression.name.text;
      const args = node.arguments.map((a) => emit(a));
      // z.preprocess(fn, schema) is a pipe from a transform (exactly what classic zod builds).
      if (ts.isIdentifier(recv) && recv.text === "z" && method === "preprocess") {
        return { base: `z.pipe(z.transform(${args[0]}), ${args[1]})`, checks: [] };
      }
      const cls = !(ts.isIdentifier(recv) && recv.text === "z") && zodClass(recv);
      if (cls) {
        const inner = chain(recv);
        const check = checkFor(method, cls, args);
        if (check) return { base: inner.base, checks: [...inner.checks, check] };
        if (WRAPPERS[method]) return { base: WRAPPERS[method](render(inner), args), checks: [] };
        if (method !== "parse" && method !== "safeParse") throw new Error(`${sf.fileName}: unhandled .${method}() at ${text.slice(node.getStart(sf), node.getStart(sf) + 80)}`);
      }
    }
    return { base: generic(node), checks: [] };
  }
  function emit(node: ts.Node): string {
    return ts.isCallExpression(node) ? render(chain(node)) : generic(node);
  }
  return text.slice(0, sf.getStart()) + generic(sf).replace(/import \{ z \} from "zod";/, 'import * as z from "zod/mini";');
}

for (const f of files) {
  const sf = program.getSourceFile(f);
  if (!sf) throw new Error(`not found: ${f}`);
  writeFileSync(f, convert(sf));
  console.log("converted", f, readFileSync(f, "utf8") === sf.text ? "(unchanged)" : "");
}
