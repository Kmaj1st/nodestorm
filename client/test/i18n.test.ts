import { afterEach, describe, expect, it } from "vitest";
import { browserLang, t, translate, useLocale } from "../src/i18n";
import { en } from "../src/i18n/en";
import { format, plurals } from "../src/i18n/format";
import { zh } from "../src/i18n/zh";
import { toMarkdown } from "../src/lib/export";
import * as ops from "../src/lib/graphOps";

/** The `{name}` placeholders a message uses (plural variables included), sorted. */
const placeholders = (msg: string) =>
  [...new Set([...msg.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]))].sort();

describe("interface messages", () => {
  it("has every English key in Chinese and vice versa", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it("translates every message, with the same placeholders", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(zh[key].trim(), key).not.toBe("");
      expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("leaves nothing in Chinese untranslated, except names", () => {
    // Messages that are only names (products, sites) or symbols read the same in both languages.
    const names = ["walk.progress", "settings.ai", "source.fromProofwiki", "source.fromAi", "absurd.game.blank", "formal.title"];
    const same = (Object.keys(en) as (keyof typeof en)[]).filter((k) => en[k] === zh[k] && !names.includes(k));
    expect(same).toEqual([]);
  });

  it("writes plural forms that resolve completely, and none in Chinese", () => {
    for (const [key, msg] of Object.entries(en)) {
      for (const n of [0, 1, 2]) {
        const params = Object.fromEntries([...msg.matchAll(/\{(\w+), plural,/g)].map((m) => [m[1], n]));
        expect(format(msg, params), key).not.toMatch(/plural,|#/);
      }
    }
    for (const [key, msg] of Object.entries(zh)) expect(msg, key).not.toContain("plural,");
  });

  it("keeps markup balanced, so rich() renders it", () => {
    for (const [key, msg] of [...Object.entries(en), ...Object.entries(zh)]) {
      expect((msg.match(/\*\*/g) ?? []).length % 2, key).toBe(0);
      expect((msg.match(/`/g) ?? []).length % 2, key).toBe(0);
    }
  });
});

describe("format", () => {
  it("fills in placeholders and leaves unknown ones", () => {
    expect(format("Import failed: {error}", { error: "bad JSON" })).toBe("Import failed: bad JSON");
    expect(format("{a} ⇄ {b}", { a: "Group", b: 2 })).toBe("Group ⇄ 2");
    expect(format("Hello {name}", {})).toBe("Hello {name}");
  });

  it("picks plural forms by number, with # as the number", () => {
    const msg = "{n, plural, one {# concept} other {# concepts}}";
    expect(plurals(msg, { n: 1 })).toBe("1 concept");
    expect(plurals(msg, { n: 0 })).toBe("0 concepts");
    expect(plurals(msg, { n: 7 })).toBe("7 concepts");
    // Several plurals and plain placeholders in one message.
    expect(format(en["install.done"], { n: 2, name: "Quotient Group", depth: 1 })).toBe(
      "Installed 2 prerequisites of Quotient Group (1 level).",
    );
    expect(format(en["install.done"], { n: 1, name: "X", depth: 3 })).toBe("Installed 1 prerequisite of X (3 levels).");
  });

  it("has no plural syntax in Chinese messages", () => {
    expect(translate("zh", "share.intro", { n: 1 })).toContain("1 个概念");
    expect(translate("zh", "install.done", { n: 2, name: "商群", depth: 2 })).toBe("已为 商群 安装 2 个前置知识（共 2 层）。");
  });
});

describe("Markdown notes in the interface language", () => {
  afterEach(() => useLocale.setState({ pref: "auto", lang: "en" }));

  it("writes headings and labels in 中文, keeping the user's text", () => {
    let g = ops.emptyGraph("代数");
    const a = ops.addNode(g, { name: "群", definition: "带有结合运算的集合。" });
    g = ops.updateNode(a.graph, a.id, { kind: "definition", source: { site: "you", title: "" } });
    const b = ops.addNode(g, { name: "子群" });
    g = ops.updateNode(b.graph, b.id, { dependsOn: [a.id] });
    useLocale.getState().setPref("zh");
    const md = toMarkdown(g);
    expect(md).toContain("## 学习顺序");
    expect(md).toContain("*类型：* 定义");
    expect(md).toContain("*来源：* 由你撰写");
    expect(md).toContain("**前置知识：** 群");
    expect(md).toContain("_还没有定义。_");
    expect(md).not.toMatch(/Study order|Kind|Prerequisites|No definition/);
  });
});

describe("interface language", () => {
  afterEach(() => useLocale.setState({ pref: "auto", lang: "en" }));

  it("picks 中文 for any Chinese browser language, else English", () => {
    for (const tag of ["zh", "zh-CN", "zh-TW", "zh-Hans-SG", "ZH-cn"]) expect(browserLang(tag)).toBe("zh");
    for (const tag of ["en-US", "de", "ja-JP", "", "zu"]) expect(browserLang(tag)).toBe("en");
  });

  it("switches t() to the chosen language, and back", () => {
    useLocale.getState().setPref("zh");
    expect(t("toolbar.add")).toBe("添加概念");
    expect(t("project.label", { name: "代数" })).toBe("项目：代数");
    useLocale.getState().setPref("en");
    expect(t("toolbar.add")).toBe("Add concept");
    expect(useLocale.getState().pref).toBe("en");
  });
});
