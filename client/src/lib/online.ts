import type { ProviderKind } from "@nodestorm/shared";
import { useSyncExternalStore } from "react";

export const OFFLINE_MESSAGE = "You're offline, so AI features are paused. Your graph is saved locally; try again once you're back online.";

/** Thrown instead of starting an AI call that can't work without a network. */
export class OfflineError extends Error {
  constructor() {
    super(OFFLINE_MESSAGE);
  }
}

/**
 * Should an AI call fail right away because the device is offline? The offline demo provider needs no
 * network, so it keeps working; every other provider would only wait for its timeout.
 */
export function offlineBlocks(provider: ProviderKind, online: boolean): boolean {
  return !online && provider !== "mock";
}

/** navigator.onLine, false only when the browser knows it has no network at all. */
export const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

export function useOnline(): boolean {
  return useSyncExternalStore((l) => {
    window.addEventListener("online", l);
    window.addEventListener("offline", l);
    return () => {
      window.removeEventListener("online", l);
      window.removeEventListener("offline", l);
    };
  }, isOnline);
}
