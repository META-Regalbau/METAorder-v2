/**
 * Routen-Register: registriert alle Routen wie beim Serverstart (ohne Datenbank) und prueft
 * - keine verdeckten Routen (eine fruehere Parameter-Route faengt die Anfragen ab,
 *   z. B. /api/orders/:orderId vor /api/orders/ticket-counts),
 * - OpenAPI-Pfadliste deckungsgleich mit den tatsaechlich registrierten /api-Routen.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import express from "express";
import { registerRoutes } from "../../server/routes";
import { openApiPaths } from "../../server/openapi/openapi.paths";

type RouteEntry = { method: string; path: string; layer: any };

async function registeredRoutes(): Promise<RouteEntry[]> {
  const app = express();
  await registerRoutes(app);
  const stack: any[] = (app as any)._router.stack;
  // Unter-Router (app.use(pfad, router)) gibt es derzeit nicht; kaemen welche dazu, muesste
  // dieser Test sie mit ihrem Praefix aufloesen - deshalb hier ausdruecklich pruefen.
  expect(stack.filter((l) => l.handle?.stack).map((l) => String(l.regexp))).toEqual([]);
  return stack
    .filter((l) => l.route)
    .flatMap((l) =>
      Object.keys(l.route.methods)
        .filter((m) => m !== "_all")
        .map((m) => ({ method: m, path: String(l.route.path), layer: l })),
    );
}

describe("Routen-Register", () => {
  it("keine Route wird von einer frueher registrierten Parameter-Route verdeckt", async () => {
    const routes = await registeredRoutes();
    expect(routes.length).toBeGreaterThan(500);
    const shadowed: string[] = [];
    routes.forEach((later, j) => {
      const sample = later.path.replace(/:([A-Za-z0-9_]+)/g, "beispielwert");
      const earlier = routes
        .slice(0, j)
        .find((e) => e.method === later.method && e.path !== later.path && e.layer.match(sample));
      if (earlier) shadowed.push(`${later.method.toUpperCase()} ${later.path} (verdeckt von ${earlier.path})`);
    });
    expect(shadowed).toEqual([]);
  });

  it("OpenAPI-Pfadliste entspricht den registrierten /api-Routen", async () => {
    const toOpenApi = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const runtime = new Set(
      (await registeredRoutes()).filter((r) => r.path.startsWith("/api")).map((r) => `${r.method} ${toOpenApi(r.path)}`),
    );
    const spec = new Set(
      Object.entries(openApiPaths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m} ${p}`)),
    );
    expect([...runtime].filter((k) => !spec.has(k)).sort()).toEqual([]);
    expect([...spec].filter((k) => !runtime.has(k)).sort()).toEqual([]);
  });
});
