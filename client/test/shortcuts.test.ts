import { describe, expect, it } from "vitest";
import { comboKeys, comboLabel, isMacPlatform, SHORTCUTS } from "../src/lib/shortcuts";

describe("keyboard shortcut labels", () => {
  it("recognises Apple platforms", () => {
    for (const p of ["MacIntel", "macOS", "iPhone", "iPad"]) expect(isMacPlatform(p)).toBe(true);
    for (const p of ["Win32", "Linux x86_64", "Windows", "Android"]) expect(isMacPlatform(p)).toBe(false);
  });

  it("uses Ctrl and + elsewhere", () => {
    expect(comboLabel(["Mod", "K"], false)).toBe("Ctrl+K");
    expect(comboLabel(["Mod", "Shift", "Z"], false)).toBe("Ctrl+Shift+Z");
    expect(comboLabel(["Shift", "click"], false)).toBe("Shift+click");
    expect(comboLabel(["Escape"], false)).toBe("Esc");
    expect(comboLabel(["Backspace"], false)).toBe("Backspace");
  });

  it("uses ⌘ and the Mac symbols on a Mac", () => {
    expect(comboLabel(["Mod", "K"], true)).toBe("⌘K");
    expect(comboLabel(["Mod", "Shift", "Z"], true)).toBe("⌘⇧Z");
    expect(comboLabel(["Mod", "click"], true)).toBe("⌘ click");
    expect(comboLabel(["Backspace"], true)).toBe("⌫");
    expect(comboLabel(["Escape"], true)).toBe("Esc");
    expect(comboKeys(["Mod", "Alt", "Enter"], true)).toEqual(["⌘", "⌥", "↩"]);
  });

  it("lists the app's shortcuts, including undo/redo, find and this help", () => {
    const all = SHORTCUTS.flatMap((g) => g.items);
    const labels = (action: string) => all.find((s) => s.action === action)?.keys.map((k) => comboLabel(k, false));
    expect(labels("Undo")).toEqual(["Ctrl+Z"]);
    expect(labels("Redo")).toEqual(["Ctrl+Shift+Z", "Ctrl+Y"]);
    expect(labels("Find concept")).toEqual(["Ctrl+K"]);
    expect(labels("Show keyboard shortcuts")).toEqual(["?"]);
    // Every action appears once, so the dialog's React keys are unique.
    expect(new Set(all.map((s) => s.action)).size).toBe(all.length);
  });
});
