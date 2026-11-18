import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Only workerd provides this module; tests use a minimal stand-in.
      "cloudflare:workers": fileURLToPath(new URL("./src/test/cloudflare-workers-stub.ts", import.meta.url)),
    },
  },
});
