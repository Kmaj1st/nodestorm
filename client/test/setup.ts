import { expect } from "vitest";

// The app fetches the Chinese messages on demand (i18n/index.ts loadLang); client tests load them up front, so
// setPref("zh") switches at once as it does in the app once they are cached.
if (expect.getState().testPath?.replace(/\\/g, "/").includes("/client/test/")) {
  await (await import("../src/i18n")).loadLang("zh");
}
