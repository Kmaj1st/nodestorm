import { findByName, normalizeName } from "@nodestorm/shared";
import { describe, expect, it } from "vitest";

describe("normalizeName keeps meaningful symbols", () => {
  it("tells C, C++ and C# apart", () => {
    const keys = ["C", "C++", "C#"].map(normalizeName);
    expect(new Set(keys).size).toBe(3);
    expect(normalizeName("c++")).toBe(normalizeName("C++"));
    expect(normalizeName("C ++")).toBe(normalizeName("C++"));
  });

  it("tells primes, stars and daggers apart", () => {
    expect(normalizeName("f′")).not.toBe(normalizeName("f"));
    expect(normalizeName("f″")).not.toBe(normalizeName("f′"));
    expect(normalizeName("A*")).not.toBe(normalizeName("A"));
    expect(normalizeName("C*-algebra")).not.toBe(normalizeName("C-algebra"));
    expect(normalizeName("A†")).not.toBe(normalizeName("A"));
    expect(normalizeName("a+b")).toBe(normalizeName("a + b"));
  });

  it("keeps the old tolerance for case, spaces, hyphens, underscores and trailing punctuation", () => {
    expect(normalizeName("  Vector   Space ")).toBe("vector space");
    expect(normalizeName("vector-space")).toBe("vector space");
    expect(normalizeName("vector_space")).toBe("vector space");
    expect(normalizeName("Group!")).toBe("group");
    expect(normalizeName("Group.")).toBe("group");
    expect(normalizeName("Groups?")).toBe("group");
    expect(normalizeName("Euler's formula")).toBe(normalizeName("Euler’s formula"));
    expect(normalizeName("Cauchy–Schwarz inequality")).toBe(normalizeName("Cauchy-Schwarz inequality"));
    expect(normalizeName("!!!")).toBe("");
    expect(normalizeName("∇")).not.toBe(normalizeName("∫"));
  });

  it("finds C++ by name without matching C", () => {
    const nodes = [{ name: "C" }, { name: "C++" }];
    expect(findByName(nodes, "c++")?.name).toBe("C++");
    expect(findByName(nodes, "c")?.name).toBe("C");
    expect(findByName(nodes, "C#")).toBeUndefined();
  });
});
