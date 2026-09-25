import { describe, expect, it } from "vitest";
import { BaikeAnswer, baikeSense } from "../src/lib/baike";
import { wikiBase, wikiName } from "../src/lib/mediawiki";

// Baidu Baike's answer (its open API, as the sandboxed JSONP call receives it) and the community wiki addresses.

const NORMAL = BaikeAnswer.parse({
  id: 1004664,
  key: "正规子群",
  desc: "数学术语",
  title: "正规子群",
  abstract: "设G是一个群 ，H是其子群。 若H的左陪集与右陪集总是相等（对任何的a∈G，aH=Ha）[1]， 则称H是G的正规子群或不变子群，记为H⊴G。[2-3]",
  url: "http://baike.baidu.com/view/1004664.htm",
});

describe("Baidu Baike", () => {
  it("turns an entry into a definition with its source, footnote marks and extra spaces removed", () => {
    expect(baikeSense("正规子群", NORMAL)).toEqual({
      name: "正规子群",
      domain: "数学术语",
      definition: "设G是一个群，H是其子群。若H的左陪集与右陪集总是相等（对任何的a∈G，aH=Ha），则称H是G的正规子群或不变子群，记为H⊴G。",
      aliases: [],
      source: { site: "Baidu Baike", title: "正规子群", url: "https://baike.baidu.com/view/1004664.htm" },
      exact: true,
    });
  });

  it("gives nothing for an empty answer, and cuts a long summary at a sentence end", () => {
    expect(baikeSense("group", BaikeAnswer.parse({}))).toBeNull();
    const long = baikeSense("群论", { title: "群论", abstract: `${"群论是研究群的数学分支。".repeat(60)}` })!;
    expect(long.definition.length).toBeLessThanOrEqual(600);
    expect(long.definition.endsWith("。")).toBe(true);
    expect(long.source.url).toBe(`https://baike.baidu.com/item/${encodeURIComponent("群论")}`);
  });
});

describe("community wikis", () => {
  it("accepts a wiki name or a pasted address, and nothing else", () => {
    expect(wikiName("fandom", "Minecraft")).toBe("minecraft");
    expect(wikiName("fandom", "https://minecraft.fandom.com/wiki/Creeper")).toBe("minecraft");
    expect(wikiName("bwiki", "https://wiki.biligame.com/ys/胡桃")).toBe("ys");
    expect(wikiName("fandom", "evil.com/x?y")).toBe("");
    expect(wikiBase({ site: "fandom", wiki: "" })).toBeNull();
    expect(wikiBase({ site: "fandom", wiki: "minecraft" })!.api).toBe("https://minecraft.fandom.com/api.php");
    expect(wikiBase({ site: "bwiki", wiki: "ys" })!.page("胡桃")).toBe(`https://wiki.biligame.com/ys/${encodeURIComponent("胡桃")}`);
    expect(wikiBase({ site: "moegirl" })!.label).toBe("Moegirl");
  });
});
