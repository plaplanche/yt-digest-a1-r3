import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["tests/*.test.ts"],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: path.join(import.meta.dirname, "wrangler.toml") },
            miniflare: {
              bindings: {
                OPS_TOKEN: "ops-test",
                PUBLIC_URL: "http://worker.test",
                GOOGLE_ISSUER: "http://google.test",
                GOOGLE_CLIENT_ID: "yt-digest-test",
                GOOGLE_CLIENT_SECRET: "google-secret-test",
                ADMIN_EMAIL: "alice@test",
                ALLOWED_ORIGINS: "http://allowed.test, http://other.test/",
                TOKEN_ENC_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
 TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
              },
            },
          }),
        ],
        test: {
          name: "workers",
          include: ["tests/workers/*.test.ts"],
          setupFiles: ["./tests/workers/setup.ts"],
        },
      },
    ],
  },
});
