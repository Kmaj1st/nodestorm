/**
 * The keyboard shortcuts that exist in the app, for the "?" help dialog. Keep this in step with the handlers:
 * App.tsx (undo/redo, Delete, F, H, Esc, Ctrl/Cmd+K), GraphCanvas.tsx (multi-select), BiRelationEdge.tsx
 * (arrowheads), FindDialog.tsx, Inspector.tsx (text fields) and Modal.tsx.
 */

import type { MessageKey } from "../i18n";

/**
 * A key combination: modifiers first, then the key. "Mod" is Ctrl, or ⌘ on a Mac. "click" and "drag" are mouse
 * actions, whose words the help dialog translates.
 */
export type Combo = string[];

export interface Shortcut {
  /** Alternative combinations that do the same (e.g. Ctrl+Shift+Z and Ctrl+Y). */
  keys: Combo[];
  /** Message key of what the shortcut does (the dialog shows it in the interface language). */
  action: MessageKey;
}

export interface ShortcutGroup {
  title: MessageKey;
  items: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "shortcuts.general",
    items: [
      { keys: [["Mod", "K"]], action: "shortcuts.find" },
      { keys: [["?"]], action: "shortcuts.help" },
      { keys: [["Escape"]], action: "shortcuts.escape" },
    ],
  },
  {
    title: "shortcuts.editing",
    items: [
      { keys: [["Mod", "Z"]], action: "shortcuts.undo" },
      { keys: [["Mod", "Shift", "Z"], ["Mod", "Y"]], action: "shortcuts.redo" },
      { keys: [["Delete"], ["Backspace"]], action: "shortcuts.delete" },
      { keys: [["Enter"], ["Escape"]], action: "shortcuts.field" },
    ],
  },
  {
    title: "shortcuts.canvas",
    items: [
      { keys: [["F"]], action: "shortcuts.focus" },
      { keys: [["H"]], action: "shortcuts.hide" },
      { keys: [["Shift", "H"]], action: "shortcuts.hideOthers" },
      { keys: [["Shift", "click"], ["Mod", "click"]], action: "shortcuts.multi" },
      { keys: [["Shift", "drag"]], action: "shortcuts.box" },
      { keys: [["Tab"], ["Enter"], ["Space"]], action: "shortcuts.arrows" },
      { keys: [["↑"], ["↓"], ["Enter"]], action: "shortcuts.findMove" },
    ],
  },
];

const MAC_NAMES: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥", Backspace: "⌫", Enter: "↩", Escape: "Esc" };
const PC_NAMES: Record<string, string> = { Mod: "Ctrl", Escape: "Esc" };

/** Is this a Mac (or iPad/iPhone), where the modifier is ⌘? */
export function isMacPlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

export const currentIsMac = () =>
  typeof navigator !== "undefined" &&
  isMacPlatform((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent);

/** The keys of a combination as shown on this platform, e.g. ["Ctrl", "Shift", "Z"] or ["⌘", "⇧", "Z"]. */
export function comboKeys(combo: Combo, mac: boolean): string[] {
  const names = mac ? MAC_NAMES : PC_NAMES;
  return combo.map((k) => names[k] ?? k);
}

/** A combination as one label: "Ctrl+Shift+Z" elsewhere, "⌘⇧Z" (or "⇧ click") on a Mac. */
export function comboLabel(combo: Combo, mac: boolean): string {
  const keys = comboKeys(combo, mac);
  if (!mac) return keys.join("+");
  const mods = keys.slice(0, -1).join("");
  const key = keys[keys.length - 1];
  return mods && key.length > 1 ? `${mods} ${key}` : mods + key;
}
