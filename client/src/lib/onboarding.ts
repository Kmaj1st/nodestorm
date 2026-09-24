/**
 * First-run onboarding, the pure parts: what is remembered in localStorage, when the welcome card shows, which tour
 * steps can be shown, and where a step's popover goes. The UI lives in panels/Onboarding.tsx.
 */

export const ONBOARDING_KEY = "nodestorm-onboarding";

export interface OnboardingState {
  /** The welcome card was dismissed (any of its choices, or the user already made concepts). */
  welcomeDone: boolean;
  /** How the tour last ended, if it ever did. */
  tour: "done" | "skipped" | null;
}

export const FRESH: OnboardingState = { welcomeDone: false, tour: null };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const defaultStorage = (): Storage | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);

/** The remembered state; anything missing, unreadable or blocked (private mode) reads as a first visit. */
export function loadOnboarding(storage = defaultStorage()): OnboardingState {
  try {
    const raw = JSON.parse(storage?.getItem(ONBOARDING_KEY) ?? "null") as Partial<OnboardingState> | null;
    if (!raw || typeof raw !== "object") return { ...FRESH };
    return {
      welcomeDone: raw.welcomeDone === true,
      tour: raw.tour === "done" || raw.tour === "skipped" ? raw.tour : null,
    };
  } catch {
    return { ...FRESH };
  }
}

export function saveOnboarding(state: OnboardingState, storage = defaultStorage()): void {
  try {
    storage?.setItem(ONBOARDING_KEY, JSON.stringify(state));
  } catch {
    /* storage blocked or full: the card may show again next time, which is harmless */
  }
}

/** The welcome card: only on a real first visit, never in the read-only viewer or once there is work to protect. */
export function shouldShowWelcome(s: { welcomeDone: boolean; viewing: boolean; hasConcepts: boolean; touring: boolean }): boolean {
  return !s.welcomeDone && !s.viewing && !s.hasConcepts && !s.touring;
}

/**
 * The tour steps, in order. `anchor` names the UI element the popover points at (see ANCHORS in Onboarding.tsx);
 * steps without one are centred cards. `needs` is what the graph must have for the step to make sense.
 */
export const TOUR_STEPS = [
  { id: "add", anchor: "add" },
  { id: "install", anchor: "install", needs: "blocked" },
  { id: "arrow", anchor: "arrow", needs: "relation" },
  { id: "mix", anchor: "mix" },
  { id: "fork", anchor: "fork" },
  // Only where the toolbar folds into ☰ (≤800px): Fork, File and Settings are hidden then, and this step says where.
  { id: "more", anchor: "more" },
  { id: "file", anchor: "file" },
  { id: "settings", anchor: "settings" },
] as const satisfies readonly { id: string; anchor: string; needs?: string }[];

export type TourStep = (typeof TOUR_STEPS)[number];
export type StepId = TourStep["id"];
export type Needs = "blocked" | "relation";

/** What the tour can see right now: which anchors are on screen, and what the graph has. */
export interface TourEnv {
  hasAnchor(anchor: TourStep["anchor"]): boolean;
  has(needs: Needs): boolean;
}

/**
 * Can this step be shown? A step that needs something in the graph (a blocked concept, a relation) is counted as
 * long as the graph has it: its anchor only appears once the step prepares the view (selects the concept). Every
 * other step needs its anchor on screen.
 */
export function stepAvailable(step: TourStep, env: TourEnv): boolean {
  return "needs" in step ? env.has(step.needs) : env.hasAnchor(step.anchor);
}

/** The steps that can be shown, in tour order. */
export function availableSteps(env: TourEnv, steps: readonly TourStep[] = TOUR_STEPS): TourStep[] {
  return steps.filter((s) => stepAvailable(s, env));
}

export interface Rect { left: number; top: number; width: number; height: number }
export type Side = "below" | "above" | "right" | "left" | "center";

/**
 * Where to put a popover of size `pop` next to `anchor` inside a `view`-sized window: below it if it fits, else
 * above, right, left; always clamped `margin` inside the window. No anchor (or a zero-size one) centres it.
 */
export function placePopover(
  anchor: Rect | null,
  pop: { width: number; height: number },
  view: { width: number; height: number },
  gap = 12,
  margin = 8,
): { left: number; top: number; side: Side } {
  const clamp = (v: number, size: number, max: number) => Math.max(margin, Math.min(v, max - size - margin));
  if (!anchor || (anchor.width === 0 && anchor.height === 0)) {
    return { left: clamp((view.width - pop.width) / 2, pop.width, view.width), top: clamp((view.height - pop.height) / 2, pop.height, view.height), side: "center" };
  }
  const cx = anchor.left + anchor.width / 2 - pop.width / 2;
  const cy = anchor.top + anchor.height / 2 - pop.height / 2;
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - gap - pop.height;
  const right = anchor.left + anchor.width + gap;
  const left = anchor.left - gap - pop.width;
  let side: Side;
  let x: number;
  let y: number;
  if (below + pop.height + margin <= view.height) [side, x, y] = ["below", cx, below];
  else if (above >= margin) [side, x, y] = ["above", cx, above];
  else if (right + pop.width + margin <= view.width) [side, x, y] = ["right", right, cy];
  else if (left >= margin) [side, x, y] = ["left", left, cy];
  // Nowhere beside it fits (tiny screen, huge anchor): over the anchor's lower part, still on screen.
  else [side, x, y] = ["below", cx, view.height - pop.height];
  return { left: clamp(x, pop.width, view.width), top: clamp(y, pop.height, view.height), side };
}

/** Is a rect (e.g. an anchor's bounding box) visible inside the window at all? display:none gives an empty rect. */
export function onScreen(r: Rect, view: { width: number; height: number }): boolean {
  if (r.width <= 0 || r.height <= 0) return false;
  return r.left + r.width > 0 && r.top + r.height > 0 && r.left < view.width && r.top < view.height;
}
