import { providerMeta, type ProviderKind } from "@nodestorm/shared";
import { useSyncExternalStore } from "react";
import { t } from "../i18n";

/** The error shown when an AI action is tried offline, in the interface language. */
export const offlineMessage = () => t("offline.message");

/** Thrown instead of starting an AI call that can't work without a network. */
export class OfflineError extends Error {
  constructor() {
    super(offlineMessage());
  }
}

/**
 * Should an AI call fail right away because the device is offline? The offline demo provider needs no
 * network, so it keeps working; every other provider would only wait for its timeout.
 */
export function offlineBlocks(provider: ProviderKind, online: boolean): boolean {
  return !online && !providerMeta(provider).local;
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
