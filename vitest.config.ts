import { defineConfig } from "vitest/config";
import path from "path";

// Eigene Konfiguration statt vite.config.ts (dort: root=client, SPA-Build, Replit-Plugins).
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@": path.resolve(import.meta.dirname, "client", "src"),
    },
  },
  test: {
    environment: "node",
    // Nur Unit-Tests; Playwright-Specs (tests/e2e) laufen getrennt ueber `npm run test:e2e`.
    include: ["tests/unit/**/*.test.ts"],
    env: {
      // Module wie server/db.ts brechen ohne DATABASE_URL beim Import ab. Eine absichtlich
      // unerreichbare Adresse laesst sie laden, verhindert aber jeden echten DB-Zugriff aus
      // Unit-Tests - lokal (dotenv ueberschreibt gesetzte Variablen nicht) wie in der CI.
      DATABASE_URL: "postgresql://unit-tests:unit-tests@127.0.0.1:1/unit-tests",
    },
  },
});
