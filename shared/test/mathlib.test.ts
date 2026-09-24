import { describe, expect, it } from "vitest";
import { MockProvider } from "../src/ai/mock";
import type { Provider } from "../src/ai/provider";
import { tasks } from "../src/ai/tasks";
import { isLeanName, leanEditorUrl, loogleDeclaration, mathlibDocUrl } from "../src/lookup/loogle";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("Mathlib names", () => {
  it("keeps plausible Lean names only, once each, at most six", async () => {
    const p: Provider = {
      id: "rec", label: "Rec", model: "m", configured: true, listModels: async () => [],
      complete: async () =>
        JSON.stringify({
          candidates: [
            { name: "`MonoidHom.ker`", why: "kernel" },
            { name: "MonoidHom.ker", why: "again" },
            { name: "kernel of a hom", why: "prose" },
            { name: "Subgroup.Normal" },
            ...["A", "B", "C", "D", "E"].map((n) => ({ name: `X.${n}` })),
          ],
        }),
    };
    const r = await tasks.mathlib(p, { node: { name: "Kernel" } });
    expect(r.candidates.map((c) => c.name)).toEqual(["MonoidHom.ker", "Subgroup.Normal", "X.A", "X.B", "X.C", "X.D"]);
    expect(r.candidates[0].why).toBe("kernel");
  });

  it("the offline demo knows its concepts", async () => {
    const r = await tasks.mathlib(new MockProvider(), { node: { name: "First Isomorphism Theorem" } });
    expect(r.candidates).toEqual([{ name: "QuotientGroup.quotientKerEquivRange", why: "G / ker φ ≃ range φ" }]);
  });

  it("opens the Lean web editor on the declaration", () => {
    expect(decodeURIComponent(leanEditorUrl("MonoidHom.ker").split("#code=")[1])).toBe("import Mathlib\n\n#check MonoidHom.ker\n");
  });

  it("recognises Lean names", () => {
    expect(isLeanName("QuotientGroup.quotientKerEquivRange")).toBe(true);
    expect(isLeanName("Nat.succ_le_iff")).toBe(true);
    expect(isLeanName("CategoryTheory.Limits.HasLimit")).toBe(true);
    expect(isLeanName("x ∈ ker f")).toBe(false);
    expect(isLeanName("\"normal\"")).toBe(false);
    expect(isLeanName("")).toBe(false);
  });
});

describe("Loogle", () => {
  it("returns the declaration of exactly that name", async () => {
    const urls: string[] = [];
    const sent: Record<string, string>[] = [];
    const f = (async (u: string, init?: RequestInit) => {
      urls.push(u);
      sent.push((init?.headers ?? {}) as Record<string, string>);
      return json({
        count: 3,
        hits: [
          { name: "MonoidHom.ker", type: " {G : Type u_1} [Group G] (f : G →* M) : Subgroup G", module: "Mathlib.Algebra.Group.Subgroup.Ker", doc: "The kernel. " },
          { name: "MonoidHom.normal_ker", type: " f.ker.Normal", module: "Mathlib.Algebra.Group.Subgroup.Ker", doc: null },
        ],
      });
    }) as unknown as typeof fetch;
    const d = await loogleDeclaration("MonoidHom.ker", { fetch: f });
    expect(d).toEqual({ name: "MonoidHom.ker", type: "{G : Type u_1} [Group G] (f : G →* M) : Subgroup G", module: "Mathlib.Algebra.Group.Subgroup.Ker", doc: "The kernel." });
    expect(urls[0]).toBe("https://loogle.lean-lang.org/json?q=MonoidHom.ker");
    // Loogle's CORS allows only User-Agent and X-Loogle-Client: any other custom header fails in a browser.
    expect(Object.keys(sent[0]).filter((h) => h.toLowerCase() !== "accept")).toEqual(["X-Loogle-Client"]);
    expect(mathlibDocUrl(d!)).toBe("https://leanprover-community.github.io/mathlib4_docs/Mathlib/Algebra/Group/Subgroup/Ker.html#MonoidHom.ker");
  });

  it("is null for an unknown name, and never sends a non-name", async () => {
    let calls = 0;
    const f = (async () => (calls++, json({ error: "unknown identifier 'Foo.bar'" }))) as unknown as typeof fetch;
    expect(await loogleDeclaration("Foo.bar", { fetch: f })).toBeNull();
    expect(await loogleDeclaration("not a name", { fetch: f })).toBeNull();
    expect(calls).toBe(1);
  });
});
