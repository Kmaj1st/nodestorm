/**
 * The community wikis a definition can come from (lib/mediawiki.ts), and the check of a wiki's name as typed in
 * Settings. Kept apart from the wiki client so the Inspector can use it without loading the look-up code.
 */
export type WikiSite = "moegirl" | "fandom" | "bwiki";

/** A Fandom subdomain or BWIKI path as the user may type it: letters, digits and dashes (a pasted URL is reduced). */
export function wikiName(site: WikiSite, raw: string): string {
  const v = raw.trim().toLowerCase();
  const m = site === "fandom" ? /^(?:https?:\/\/)?([a-z0-9-]+)\.fandom\.com/.exec(v) : /wiki\.biligame\.com\/([a-z0-9_-]+)/.exec(v);
  const name = m ? m[1] : v;
  return /^[a-z0-9][a-z0-9_-]{0,60}$/.test(name) ? name : "";
}
