/** Message parameters: numbers (for plurals and counts) or text. */
export type Params = Record<string, string | number>;

// `{n, plural, one {…} other {…}}`; a branch may contain `#` and plain `{name}` placeholders.
const PLURAL = /\{(\w+), plural, one \{((?:[^{}]|\{\w+\})*)\} other \{((?:[^{}]|\{\w+\})*)\}\}/g;

/** Resolve the plural forms of a message: `one` when the parameter is 1, else `other` (`#` becomes the number). */
export function plurals(template: string, params: Record<string, unknown> = {}): string {
  return template.replace(PLURAL, (_, name: string, one: string, other: string) => {
    const n = Number(params[name]);
    return (n === 1 ? one : other).replaceAll("#", String(params[name] ?? "#"));
  });
}

/**
 * Split a message into text and `{name}` placeholders: even entries are text, odd entries are parameter names.
 * Used by `format` (strings) and `rich` (React nodes).
 */
export const splitPlaceholders = (text: string) => text.split(/\{(\w+)\}/);

/** Fill in a message: plural forms first, then `{name}` placeholders. Unknown placeholders are left as they are. */
export function format(template: string, params: Params = {}): string {
  return splitPlaceholders(plurals(template, params))
    .map((part, i) => (i % 2 ? (part in params ? String(params[part]) : `{${part}}`) : part))
    .join("");
}
