import { createProvider, ProviderError, withDeadline } from "@nodestorm/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listJoin, useLocale } from "../src/i18n";
import { errorMessage } from "../src/lib/errors";
import * as ops from "../src/lib/graphOps";
import * as proj from "../src/lib/projects";
import { texReview } from "../src/lib/texImport";

const zh = () => useLocale.setState({ pref: "zh", lang: "zh" });

afterEach(() => {
  useLocale.setState({ pref: "auto", lang: "en" });
  vi.unstubAllGlobals();
});

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("AI provider errors in the interface language", () => {
  it("a timeout carries a code, translated with its numbers", async () => {
    const err = await withDeadline("DeepSeek", { timeoutMs: 20 }, () => new Promise(() => {})).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ code: "timeout", params: { provider: "DeepSeek", seconds: 0 } });
    expect(errorMessage(err)).toMatch(/^DeepSeek didn't respond within 0 s\./);
    zh();
    expect(errorMessage(err)).toMatch(/^DeepSeek 在 0 秒内没有响应。/);
  });

  it("a rejected key is said as such, with the provider's own message after it", async () => {
    vi.stubGlobal("fetch", async () => json({ error: { message: "Invalid token" } }, 401));
    const p = createProvider("siliconflow", { apiKey: "bad", model: "m" });
    const err = await p.complete([{ role: "user", content: "hi" }]).catch((e) => e);
    // The English message stays as before (logs, the server's JSON); the code is what the interface shows.
    expect(err.message).toMatch(/HTTP 401/);
    expect(err.code).toBe("invalidKey");
    zh();
    expect(errorMessage(err)).toMatch(/^SiliconFlow /);
    expect(errorMessage(err)).toContain("拒绝了这个 API 密钥");
    expect(errorMessage(err)).toContain("（HTTP 401: {\"error\":{\"message\":\"Invalid token\"}}）");
  });

  it("server errors name the HTTP status and keep the body", async () => {
    vi.stubGlobal("fetch", async () => new Response("Bad gateway", { status: 400 }));
    const p = createProvider("deepseek", { apiKey: "k", model: "m" });
    const err = await p.complete([{ role: "user", content: "hi" }]).catch((e) => e);
    expect(err).toMatchObject({ code: "http", params: { status: 400 }, detail: "Bad gateway" });
    expect(errorMessage(err)).toBe("DeepSeek answered with an error (HTTP 400). (Bad gateway)");
    zh();
    expect(errorMessage(err)).toBe("DeepSeek 返回了错误（HTTP 400）。（Bad gateway）");
  });

  it("a rate limit that outlasts the retries says when to try again", async () => {
    vi.stubGlobal("fetch", async () => json({}, 429, { "retry-after": "30" }));
    const p = createProvider("openai", { apiKey: "k", model: "m", timeoutMs: 5000 });
    const err = await p.complete([{ role: "user", content: "hi" }]).catch((e) => e);
    expect(err).toMatchObject({ code: "rateLimited", status: 429, params: { seconds: 30 } });
    zh();
    expect(errorMessage(err)).toMatch(/请在 30 秒后重试/);
  });

  it("errors without a code (or with one this page doesn't know) keep their message", () => {
    expect(errorMessage(new Error("plain"))).toBe("plain");
    expect(errorMessage(new ProviderError("old server", 502, undefined, { code: "brandNew" as never }))).toBe("old server");
    expect(errorMessage("text")).toBe("text");
  });
});

describe("text the app writes into the graph", () => {
  it("prerequisite links and their explanations are in the interface language of the moment", () => {
    zh();
    let g = ops.emptyGraph("代数");
    const a = ops.addNode(g, { name: "群", definition: "" });
    const b = ops.addNode(a.graph, { name: "子群", definition: "" });
    g = ops.link(b.graph, b.id, a.id, "uses", "子群是群的子集。");
    const rel = ops.findRelation(g, b.id, a.id)!;
    expect(rel.aToB.kind).toBe("使用");
    expect(rel.bToA).toEqual({ kind: "none", explanation: "群 是 子群 的前置知识：子群是群的子集。" });
    // Stored data isn't rewritten when the language changes.
    useLocale.setState({ pref: "en", lang: "en" });
    expect(ops.findRelation(g, b.id, a.id)!.aToB.kind).toBe("使用");
  });

  it("LaTeX references are explained in Chinese", () => {
    zh();
    const src = String.raw`\begin{definition}[Group]A group is a set.\label{d}\end{definition}
\begin{theorem}Every group of Theorem~\ref{d} is fine.\end{theorem}`;
    const res = texReview(src);
    expect(res.links.map((l) => l.aToB.explanation)).toContain("引用了 Definition 1（Group）。");
  });

  it("default project names follow the interface language, and both count as untitled", () => {
    zh();
    let ws = proj.createProject({ graphs: {}, projects: {}, projectId: "", activeId: "" }, "第一个");
    ws = proj.createProject(ws);
    ws = proj.createProject(ws);
    expect(proj.projectList(ws).map((p) => p.name)).toEqual(["第一个", "未命名项目", "未命名项目 2"]);
    const first = proj.projectList(ws)[0];
    expect(proj.projectList(proj.duplicateProject(ws, first.id)).map((p) => p.name)).toContain("第一个（副本）");
    expect(proj.isUntitledProjectName("未命名项目 2")).toBe(true);
    expect(proj.isUntitledProjectName("Untitled project")).toBe(true);
    expect(proj.isUntitledProjectName("第一个")).toBe(false);
    const empty = proj.normalizeWorkspace({ graphs: {}, projects: {}, projectId: "", activeId: "" });
    expect(Object.values(empty.projects).map((p) => p.name)).toEqual(["我的头脑风暴"]);
  });

  it("“no relation” may be typed in either language; it is stored as the keyword none", () => {
    for (const w of ["none", " None ", "无", "没有", "无关系"]) expect(ops.typedKind(w)).toBe("none");
    expect(ops.typedKind(" generalizing ")).toBe("generalizing");
    expect(ops.typedKind("无穷")).toBe("无穷");
  });
});

describe("listJoin", () => {
  it("lists names with commas in English and 、 in Chinese", () => {
    expect(listJoin(["ProofWiki", "Wikipedia", "Wikidata"])).toBe("ProofWiki, Wikipedia, Wikidata");
    expect(listJoin(["群", "环"], "zh")).toBe("群、环");
    zh();
    expect(listJoin(["ProofWiki", "Wikipedia", "Wikidata"])).toBe("ProofWiki、Wikipedia、Wikidata");
    expect(listJoin(["one"])).toBe("one");
    expect(listJoin([])).toBe("");
  });
});
