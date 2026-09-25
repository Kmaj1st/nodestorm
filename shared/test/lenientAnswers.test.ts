import { describe, expect, it } from "vitest";
import { tasks } from "../src/ai/tasks";
import type { Provider } from "../src/ai/provider";

/** A provider that always answers with `reply`, counting the calls. */
function fixed(reply: unknown): Provider & { calls: number } {
  const p = {
    label: "Fixed",
    calls: 0,
    async complete() {
      p.calls++;
      return JSON.stringify(reply);
    },
  };
  return p as unknown as Provider & { calls: number };
}

describe("AI answers with a prerequisite role in another spelling", () => {
  it("reads 'Uses' / ' DERIVES ' as the role instead of failing the whole check", async () => {
    const p = fixed({
      prerequisites: [
        { name: "Group", role: "Uses", reason: "r" },
        { name: "Kernel", role: " DERIVES ", reason: "r" },
      ],
      kind: "theorem",
    });
    const r = await tasks.deps(p, { node: { name: "First Isomorphism Theorem" } });
    expect(r.prerequisites.map((x) => x.role)).toEqual(["uses", "derives"]);
    expect(p.calls).toBe(1);
  });

  it("does the same for prerequisites found in extracted text", async () => {
    const p = fixed({
      concepts: [{ name: "Group" }, { name: "Subgroup" }],
      prerequisites: [{ dependent: "Subgroup", prerequisite: "Group", role: "Assumes" }],
    });
    const r = await tasks.extract(p, { text: "A subgroup is a subset of a group that is a group." });
    expect(r.prerequisites.map((x) => x.role)).toEqual(["assumes"]);
  });
});
