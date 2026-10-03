import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/lib/__tests__/editor-async-safety.test.ts"],
  },
});
