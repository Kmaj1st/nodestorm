import { create } from "zustand";

/** Tokens the provider reported for AI calls made from this page (browser mode). In memory only. */
export const useUsage = create<{ tokens: number }>(() => ({ tokens: 0 }));

export const addUsage = (tokens: number) => useUsage.setState((s) => ({ tokens: s.tokens + tokens }));

/** "950", "12.3k", "1.2M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
