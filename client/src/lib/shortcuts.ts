/**
 * The keyboard shortcuts that exist in the app, for the "?" help dialog. Keep this in step with the handlers:
 * App.tsx (undo/redo, Delete, F, Esc, Ctrl/Cmd+K), GraphCanvas.tsx (multi-select), BiRelationEdge.tsx
 * (arrowheads), FindDialog.tsx, Inspector.tsx (text fields) and Modal.tsx.
 */

// User-visible strings, in one place for the i18n layer.
const TEXT = {
  general: "General",
  canvas: "Canvas",
  editing: "Editing",
  find: "Find concept",
  shortcuts: "Show keyboard shortcuts",
  escape: "Close a dialog or menu; leave focus mode",
  undo: "Undo",
  redo: "Redo",
  delete: "Delete the selected concepts, or the open relation",
  field: "In a name or relation field: save the edit (Enter) or revert it (Esc)",
  focus: "Focus on the selected concept",
  multi: "Select several concepts",
  box: "Select an area",
  arrows: "Move between relation arrowheads, then open one",
  findMove: "In Find: move through the results, then go to one",
  click: "click",
  drag: "drag",
};

/** A key combination: modifiers first, then the key. "Mod" is Ctrl, or ⌘ on a Mac. */
export type Combo = string[];

export interface Shortcut {
  /** Alternative combinations that do the same (e.g. Ctrl+Shift+Z and Ctrl+Y). */
  keys: Combo[];
  action: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: TEXT.general,
    items: [
      { keys: [["Mod", "K"]], action: TEXT.find },
      { keys: [["?"]], action: TEXT.shortcuts },
      { keys: [["Escape"]], action: TEXT.escape },
    ],
  },
  {
    title: TEXT.editing,
    items: [
      { keys: [["Mod", "Z"]], action: TEXT.undo },
      { keys: [["Mod", "Shift", "Z"], ["Mod", "Y"]], action: TEXT.redo },
      { keys: [["Delete"], ["Backspace"]], action: TEXT.delete },
      { keys: [["Enter"], ["Escape"]], action: TEXT.field },
    ],
  },
  {
    title: TEXT.canvas,
    items: [
      { keys: [["F"]], action: TEXT.focus },
      { keys: [["Shift", TEXT.click], ["Mod", TEXT.click]], action: TEXT.multi },
      { keys: [["Shift", TEXT.drag]], action: TEXT.box },
      { keys: [["Tab"], ["Enter"], ["Space"]], action: TEXT.arrows },
      { keys: [["↑"], ["↓"], ["Enter"]], action: TEXT.findMove },
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
