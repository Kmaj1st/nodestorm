import { kbDefinition } from "@nodestorm/shared";
import type { WebResult } from "./webSearch";

/**
 * The offline demo's pretend web: pages for the concepts its knowledge base knows, on three made-up sites. Two quote
 * the knowledge base's definition word for word; the forum's answer is sloppy and wrong, so the reliability check has
 * something to flag. Loaded by lib/webSearch.ts only when the demo provider searches, so the knowledge base stays out
 * of the first-paint bundle. `.example` domains can never be real sites.
 */
export function demoResults(name: string): WebResult[] {
  const kb = kbDefinition(name.trim());
  if (!kb) return [];
  const n = kb.name;
  const lower = n.toLowerCase();
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
      title: `What is a ${lower}? - Demo Forum`,
      url: `https://demo-forum.example/t/what-is-a-${slug.toLowerCase()}`,
      site: "demo-forum.example",
      text: `Honestly a ${lower} is basically just any set of numbers you can add together, no rules needed. That's all you need for the exam, trust me.`,
    },
  ];
}
