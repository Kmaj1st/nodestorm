import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test-setup.ts", "./client/test/setup.ts"],
    include: ["server/test/**/*.test.ts", "client/test/**/*.test.ts", "shared/test/**/*.test.ts"],
  },
});
