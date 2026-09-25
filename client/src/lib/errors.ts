import { ProviderError, type ProviderErrorCode, type ProviderErrorInfo } from "@nodestorm/shared";
import { t, type MessageKey } from "../i18n";

const KEYS: Record<ProviderErrorCode, MessageKey> = {
  timeout: "aiErr.timeout",
  rateLimited: "aiErr.rateLimited",
  noKey: "aiErr.noKey",
  invalidKey: "aiErr.invalidKey",
  modelDenied: "aiErr.modelDenied",
  modelNotFound: "aiErr.modelNotFound",
  noModel: "aiErr.noModel",
  unreachable: "aiErr.unreachable",
  sdkLoad: "aiErr.sdkLoad",
  http: "aiErr.http",
  declined: "aiErr.declined",
  empty: "aiErr.empty",
  emptyReasoning: "aiErr.emptyReasoning",
  continuations: "aiErr.continuations",
  malformed: "aiErr.malformed",
  noValidLink: "aiErr.noValidLink",
  chainBroken: "aiErr.chainBroken",
  unknownProvider: "aiErr.unknownProvider",
};

/** A coded provider error in the interface language, with its raw detail (HTTP body, provider message) after it. */
export function providerErrorText(info: ProviderErrorInfo): string {
  const params = info.params ?? {};
  const key = info.code === "rateLimited" && params.seconds !== undefined ? "aiErr.rateLimitedWait" : KEYS[info.code];
  const message = t(key, params);
  const detail = info.detail?.trim();
  return detail ? t("aiErr.withDetail", { message, detail }) : message;
}

/**
 * What to tell the user about a failure: provider errors are translated from their code (the English message is
 * only a fallback for errors without one); other errors' messages are already meant for the user.
 */
export function errorMessage(e: unknown): string {
  // A code from a newer server that this page doesn't know falls back to the English message.
  if (e instanceof ProviderError && e.code && Object.hasOwn(KEYS, e.code)) return providerErrorText({ code: e.code, params: e.params, detail: e.detail });
  return e instanceof Error ? e.message : String(e);
}
