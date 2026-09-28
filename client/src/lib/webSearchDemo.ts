import { kbDefinition } from "@nodestorm/shared";
import type { WebResult } from "./webSearch";

/**
 * The offline demo's pretend web: pages for the concepts its knowledge base knows, on three made-up sites. Two quote
 * the knowledge base's definition word for word; the forum's answer is sloppy and wrong, so the reliability check has
 * something to flag. Loaded by lib/webSearch.ts only when the demo provider searches, so the knowledge base stays out
 * of the first-paint bundle. `.example` domains can never be real sites.
 */
export function demoResults(name: string): WebResult[] {
  // A name in Chinese characters finds the Chinese pages, as a real search would.
  if (/\p{Script=Han}/u.test(name)) return demoResultsZh(name);
  const kb = kbDefinition(name.trim());
  if (!kb) return [];
  const n = kb.name;
  const lower = n.toLowerCase();
  const a = /^[aeiou]/.test(lower) ? "an" : "a"; // "an isomorphism"
  const slug = encodeURIComponent(n.replace(/ /g, "_"));
  const also = kb.aliases.length ? ` Also called: ${kb.aliases.join(", ")}.` : "";
  return [
    {
      engine: "demo",
      title: `${n} - Demo Encyclopedia`,
      url: `https://demo-encyclopedia.example/wiki/${slug}`,
      site: "demo-encyclopedia.example",
      text: `${n} (mathematics). ${kb.definition}${also} It is one of the basic notions of abstract algebra and appears early in most courses on the subject.`,
      published: "2024-05-01",
    },
    {
      engine: "demo",
      title: `Lecture 3: ${n}`,
      url: `https://demo-lecture-notes.example/algebra/${slug.toLowerCase()}.html`,
      site: "demo-lecture-notes.example",
      text: `We now introduce the notion of ${lower}. Definition. ${kb.definition} Before going on, work through the examples on this week's exercise sheet.`,
    },
    {
      engine: "demo",
      title: `What is ${a} ${lower}? - Demo Forum`,
      url: `https://demo-forum.example/t/what-is-a-${slug.toLowerCase()}`,
      site: "demo-forum.example",
      text: `Honestly ${a} ${lower} is basically just any set of numbers you can add together, no rules needed. That's all you need for the exam, trust me.`,
    },
  ];
}

/** The pretend web in Chinese: the same three sites' Chinese pages, and again a forum answer that is wrong. */
function demoResultsZh(name: string): WebResult[] {
  const kb = kbDefinition(name.trim(), true);
  if (!kb) return [];
  const n = kb.name;
  const slug = encodeURIComponent(n);
  const also = kb.aliases.length ? `又称：${kb.aliases.join("、")}。` : "";
  return [
    {
      engine: "demo",
      title: `${n} - 演示百科`,
      url: `https://zh.demo-encyclopedia.example/wiki/${slug}`,
      site: "zh.demo-encyclopedia.example",
      text: `${n}是数学中的概念。定义：${kb.definition}${also}它是抽象代数的基本概念之一，出现在大多数相关课程的开头。`,
      published: "2024-05-01",
    },
    {
      engine: "demo",
      title: `第3讲：${n}`,
      url: `https://zh.demo-lecture-notes.example/algebra/${slug}.html`,
      site: "zh.demo-lecture-notes.example",
      text: `我们现在引入${n}的概念。定义：${kb.definition}继续之前，请先做完本周习题中的例子。`,
    },
    {
      engine: "demo",
      title: `${n}到底是什么？- 演示论坛`,
      url: `https://zh.demo-forum.example/t/${slug}`,
      site: "zh.demo-forum.example",
      text: `说实话，${n}基本上就是一堆能相加的数的集合，根本不需要什么规则。考试知道这些就够了，相信我。`,
    },
  ];
}
