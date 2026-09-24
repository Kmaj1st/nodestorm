import { create } from "zustand";
import { loadOnboarding, saveOnboarding, type OnboardingState } from "../lib/onboarding";

interface Onboarding extends OnboardingState {
  /** The guided tour is running (not persisted: a reload ends it). */
  touring: boolean;
  dismissWelcome(): void;
  /** Start (or restart) the tour; also closes the welcome card for good. */
  startTour(): void;
  endTour(how: "done" | "skipped"): void;
}

/** First-run onboarding state (lib/onboarding.ts); the welcome card and tour are in panels/Onboarding.tsx. */
export const useOnboarding = create<Onboarding>()((set, get) => {
  const persist = (patch: Partial<OnboardingState>) => {
    const { welcomeDone, tour } = { ...get(), ...patch };
    saveOnboarding({ welcomeDone, tour });
  };
  return {
    ...loadOnboarding(),
    touring: false,
    dismissWelcome() {
      if (get().welcomeDone) return;
      persist({ welcomeDone: true });
      set({ welcomeDone: true });
    },
    startTour() {
      persist({ welcomeDone: true });
      set({ welcomeDone: true, touring: true });
    },
    endTour(tour) {
      persist({ tour });
      set({ tour, touring: false });
    },
  };
});

/** "Show tour again" (the ? dialog). */
export const startTour = () => useOnboarding.getState().startTour();
