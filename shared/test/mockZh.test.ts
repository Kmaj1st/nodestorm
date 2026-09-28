import { describe, expect, it } from "vitest";
import { answersInChinese, kbDefinition, MockProvider } from "../src/ai/mock";
import { tasks } from "../src/ai/tasks";
import { depsPrompt, withLanguage } from "../src/ai/prompts";

/** The offline demo answers in Chinese for Chinese names (or the 中文 setting), in English otherwise. */
const HAN = /\p{Script=Han}/u;
const mock = new MockProvider();
const n = (name: string) => ({ name });

describe("offline demo: which language", () => {
  it("follows the setting, and with auto (or none) the names' script", () => {
    expect(answersInChinese("Chinese (中文)", ["Kernel"])).toBe(true);
    expect(answersInChinese("English", ["核"])).toBe(false);
    expect(answersInChinese("French (Français)", ["核"])).toBe(false);
    expect(answersInChinese("auto", ["核"])).toBe(true);
    expect(answersInChinese(undefined, ["核"])).toBe(true);
    expect(answersInChinese("auto", ["Kernel"])).toBe(false);
  });

  it("reads the language from the prompt when the request carries none", async () => {
    const zh = withLanguage(depsPrompt({ node: { name: "Kernel", definition: "", aliases: [] }, existing: [] }), "Chinese (中文)");
    const res = JSON.parse(await mock.complete(zh));
    expect(res.prerequisites[0]).toMatchObject({ name: "同态", reason: "核是对同态定义的。" });
    const auto = withLanguage(depsPrompt({ node: { name: "Kernel", definition: "", aliases: [] }, existing: [] }), "auto");
    expect(JSON.parse(await mock.complete(auto)).prerequisites[0].name).toBe("Homomorphism");
  });

  it("knows the Chinese names and aliases of its knowledge base", () => {
    expect(kbDefinition("因子群", true)).toEqual({ name: "商群", definition: expect.stringContaining("陪集"), aliases: ["因子群"] });
    expect(kbDefinition("同态核")?.name).toBe("Kernel");
    expect(kbDefinition("拓扑空间", true)).toBeNull();
  });
});

describe("offline demo in Chinese, task by task", () => {
  it("deps: Chinese prerequisites and reasons, matched to the graph in either language", async () => {
    const res = await tasks.deps(mock, { node: n("第一同构定理"), existing: [n("同态"), n("Isomorphism")] });
    expect(res.kind).toBe("theorem");
    expect(res.prerequisites).toEqual([
      { name: "同态", role: "uses", reason: "定理从一个同态 $\\varphi: G \\to H$ 出发。", matchesExisting: "同态" },
      { name: "同构", role: "derives", reason: expect.stringMatching(/^它的结论是一个同构/), matchesExisting: "Isomorphism" },
    ]);
    // The 中文 setting turns an English name's answer Chinese too.
    expect((await tasks.deps(mock, { node: n("Kernel") }, { language: "Chinese (中文)" })).prerequisites[0].name).toBe("同态");
    expect((await tasks.deps(mock, { node: n("Kernel") })).prerequisites[0].name).toBe("Homomorphism");
    // A name that says what it is, in Chinese.
    expect((await tasks.deps(mock, { node: n("佐恩引理") })).kind).toBe("lemma");
    expect((await tasks.deps(mock, { node: n("选择公理") })).kind).toBe("axiom");
  });

  it("relate (Mix): an active Chinese label (使用), the other side none", async () => {
    const res = await tasks.relate(mock, { a: n("核"), b: n("同态") });
    expect(res.aToB).toEqual({ kind: "使用", explanation: "核是对同态定义的。" });
    expect(res.bToA).toEqual({ kind: "none", explanation: "同态是核的构件：核是对同态定义的。" });
    const none = await tasks.relate(mock, { a: n("群"), b: n("鸡") });
    expect(none.aToB.explanation).toBe("离线模型不知道群对鸡有什么直接影响。");
    expect((await tasks.relate(mock, { a: n("第一同构定理"), b: n("同构") })).aToB.kind).toBe("推导出");
    expect((await tasks.relate(mock, { a: n("Kernel"), b: n("Homomorphism") })).aToB.kind).toBe("using");
  });

  it("derive: Chinese proposals and labels", async () => {
    const syn = (await tasks.derive(mock, { selected: [n("群"), n("子群")] })).proposals[0];
    expect(syn.name).toBe("群与子群的综合");
    expect(syn.definition).toBe("综合了群、子群的一个想法。");
    expect(syn.links[0]).toEqual({ to: "群", fromNew: { kind: "拓展", explanation: "拓展了群。" }, toNew: { kind: "促成", explanation: "群提供了这个综合的一部分。" } });
    const ker = (await tasks.derive(mock, { selected: [n("同态")] })).proposals[0];
    expect(ker).toMatchObject({ name: "核", aliases: ["同态核"], links: [{ to: "同态", fromNew: { kind: "衡量单射性" }, toNew: { kind: "决定" } }] });
    expect((await tasks.derive(mock, { selected: [n("Group"), n("Subgroup")] })).proposals[0].name).toBe("Synthesis of Group & Subgroup");
  });

  it("extract: Chinese names found without spaces (正规子群 is not also 子群), quotes per sentence, 「」 terms", async () => {
    const res = await tasks.extract(mock, { text: "每个同态都有一个核，它是正规子群。我们把它叫作「主引理」。第一同构定理用到商群。", existing: [n("群")] });
    expect(res.concepts.map((c) => c.name)).toEqual(["同态", "核", "正规子群", "第一同构定理", "商群", "主引理"]);
    expect(res.concepts[1]).toMatchObject({ definition: expect.stringContaining("单位元"), quote: "每个同态都有一个核，它是正规子群。" });
    expect(res.prerequisites).toContainEqual({ dependent: "核", prerequisite: "同态", role: "uses", reason: "核是对同态定义的。" });
    expect(res.prerequisites).toContainEqual(expect.objectContaining({ dependent: "商群", prerequisite: "群" }));
    const rel = (await tasks.extract(mock, { text: "同态有一个性质，叫作「保积性」。" })).relations[0];
    expect(rel).toMatchObject({ from: "保积性", to: "同态", aToB: { kind: "伴随出现" }, bToA: { kind: "提供背景" } });
  });

  it("explain: every level and voice in Chinese, the summary plain", async () => {
    for (const level of ["intuitive", "rigorous", "example-driven"] as const) {
      for (const voice of ["plain", "nature-documentary", "sports-commentator", "noir-detective", "medieval-scholar", "infomercial", "shakespearean"] as const) {
        const res = await tasks.explain(mock, { node: n("同态"), prerequisites: [n("群")], relations: [], level, voice });
        expect(res.summary).toBe("在代数结构之间保持运算的映射，例如对群有 $\\varphi(ab) = \\varphi(a)\\varphi(b)$。");
        for (const text of [res.intuition, ...res.keyPoints, ...res.examples.map((e) => e.body), ...res.pitfalls, res.furtherReading[0].title]) {
          expect(text).toMatch(HAN);
          expect(text).not.toMatch(/\b(Intuitively|Formally|Look at|Observe|Remarkably|Herein|Hark|clue)\b/);
        }
      }
    }
    const unknown = await tasks.explain(mock, { node: n("拓扑空间"), prerequisites: [], relations: [], level: "intuitive", voice: "plain" });
    expect(unknown.summary).toBe("拓扑空间不在离线模型的知识库中。");
    expect((await tasks.explain(mock, { node: n("Homomorphism"), prerequisites: [], relations: [], level: "intuitive", voice: "plain" })).intuition).toMatch(/^Intuitively: /);
  });

  it("anatomy: the KB theorems and a statement split at 若…，则…", async () => {
    const lagrange = await tasks.anatomy(mock, { node: n("拉格朗日定理"), prerequisites: [] });
    expect(lagrange.hypotheses[0].text).toBe("$G$ 是有限群。");
    expect(lagrange.nonExamples[0]).toMatch(/^逆命题不成立/);
    expect((await tasks.anatomy(mock, { node: n("第一同构定理"), prerequisites: [] })).conclusion).toMatch(/同构由/);
    const other = await tasks.anatomy(mock, { node: { name: "某定理", definition: "若 $G$ 有限，则 $|H|$ 整除 $|G|$。" }, prerequisites: [] });
    expect(other.hypotheses[0]).toMatchObject({ text: "$G$ 有限", whyNeeded: "这个命题只在这个假设下成立。" });
    expect(other.conclusion).toBe("$|H|$ 整除 $|G|$。");
    expect(other.proofIdea).toMatch(/^离线演示/);
  });

  it("quiz: recall (with Chinese wrong options), connect and apply in Chinese", async () => {
    const mc = await tasks.quiz(mock, { node: n("正规子群"), prerequisites: [n("子群")], style: "recall", multipleChoice: true });
    expect(mc.question).toBe("下面哪一项是正规子群的定义？");
    expect(mc.choices).toHaveLength(4);
    expect(mc.choices!.every((c) => HAN.test(c))).toBe(true);
    expect(mc.hints).toEqual(["它建立在子群之上。", "它以“$G$ 的子群”开头……"]);
    const connect = await tasks.quiz(mock, { node: n("正规子群"), prerequisites: [n("子群")], style: "connect", multipleChoice: false });
    expect(connect).toMatchObject({ question: "正规子群是如何建立在子群之上的？", answer: "正规子群是在共轭下不变的子群。" });
    const apply = await tasks.quiz(mock, { node: n("同态"), prerequisites: [], style: "apply", multipleChoice: false });
    expect(apply.answer).toMatch(/^指数映射：/);
  });

  it("absurd chain: Chinese links, quips, title and moral; stops and aliases found in Chinese", async () => {
    const res = await tasks.absurdChain(mock, { from: n("同态"), to: n("烤面包片"), style: "epic" });
    expect(res.title).toBe("同态与烤面包片的传奇");
    expect(res.chain.map((h) => h.to)).toEqual(["指数函数", "傅里叶变换", "热方程", "热", "美拉德反应", "烤面包片"]);
    expect(res.chain[0]).toMatchObject({ kind: "包括", quip: "看哪，指数函数自同态中崛起，万古为之震颤。" });
    expect(res.moral).toMatch(HAN);
    const via = await tasks.absurdChain(mock, { from: n("歌剧"), to: n("鸡蛋"), via: [n("子群")], style: "deadpan" });
    expect(via.chain[0]).toMatchObject({ from: "歌剧", to: "文字", kind: "借用字符于" });
    expect(via.chain.some((h) => h.to === "子群")).toBe(true);
    expect(via.chain.at(-1)!.to).toBe("鸡蛋");
    expect(via.chain.every((h) => HAN.test(h.kind) && HAN.test(h.fact) && HAN.test(h.quip))).toBe(true);
  });

  it("connect: the definition's Chinese mentions, labelled 使用", async () => {
    const res = await tasks.connect(mock, {
      node: { name: "核", definition: "同态映到单位元的元素全体。" },
      existing: [n("正规子群")],
      linked: [],
      count: 8,
    });
    expect(res.suggestions[0]).toMatchObject({ name: "同态", keyword: "同态", aToB: { kind: "使用", explanation: "它的定义提到了“同态”。" } });
    const group = await tasks.connect(mock, { node: n("群"), existing: [], linked: [], count: 8 });
    expect(group.suggestions.map((s) => s.name)).toContain("子群");
    expect(group.suggestions.find((s) => s.name === "子群")!.bToA.explanation).toBe("子群建立在群之上。");
  });

  it("name (describe it): Chinese descriptions find the KB concepts", async () => {
    expect((await tasks.name(mock, { description: "保持运算的映射", context: [] })).candidates.map((c) => c.name)).toEqual(["同态", "同构"]);
    expect((await tasks.name(mock, { description: "双射的同态", context: [] })).candidates[0].name).toBe("同构");
    expect((await tasks.name(mock, { description: "被同态映到单位元的元素", context: [] })).candidates[0].name).toBe("核");
    expect((await tasks.name(mock, { description: "把东西排成一列的方法", context: [] })).candidates[0].name).toBe("把东西排成一列的");
  });

  it("assess: Chinese reasons, sense and note; passages quoted from the Chinese pages", async () => {
    const def = "同态 $\\varphi$ 映到单位元的元素构成的集合 $\\ker\\varphi$。";
    const sources = [
      { id: "w1", kind: "web", site: "zh.demo-encyclopedia.example", title: "核", url: "https://a.example", text: `核是数学中的概念。定义：${def}又称：同态核。` },
      { id: "w2", kind: "web", site: "zh.demo-forum.example", title: "核", url: "https://b.example", text: "说实话，核基本上就是一堆能相加的数的集合。相信我。" },
      { id: "w3", kind: "web", site: "fruit.example", title: "核桃", url: "https://c.example", text: "核桃是一种坚果，营养丰富。" },
    ];
    const res = await tasks.assess(mock, { name: "核", sources });
    const by = Object.fromEntries(res.ratings.map((r) => [r.id, r]));
    expect(by.w1).toMatchObject({ reliability: "high", reasons: "百科或课程页面；与其他来源一致。", sense: "数学", passage: def });
    expect(by.w2).toMatchObject({ reliability: "low", reasons: expect.stringMatching(/^论坛帖子/) });
    expect(by.w3).toMatchObject({ reasons: expect.stringMatching(/另一个含义/), sense: "核桃是一种坚果" });
    expect(res.note).toBe("这些来源对定义的说法一致，只有 zh.demo-forum.example 与其他来源矛盾。");
  });

  it("resolveCycle and mathlib: a Chinese reason; Lean names stay Lean names", async () => {
    const cycle = await tasks.resolveCycle(mock, {
      links: [{ from: n("鸡"), to: { name: "蛋", definition: "一种很长的定义" } }, { from: n("蛋"), to: { name: "鸡", definition: "短" } }],
    });
    expect(cycle).toEqual({ remove: [0], reason: "“蛋”建立在“鸡”之上，而不是反过来。" });
    const lean = await tasks.mathlib(mock, { node: n("核"), context: [] });
    expect(lean.candidates[0]).toEqual({ name: "MonoidHom.ker", why: "作为子群的核" });
    expect((await tasks.mathlib(mock, { node: n("Kernel"), context: [] })).candidates[0].why).toBe("the kernel as a subgroup");
  });
});
