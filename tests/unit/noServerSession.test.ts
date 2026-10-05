/**
 * Keine Server-Sitzung: die Anmeldung laeuft ueber das JWT-Cookie (requireAuth). express-session lief
 * mit dem MemoryStore (in Produktion "not designed for a production environment") und speicherte nie
 * etwas - der Login ruft kein req.logIn, passport.session() fand nie einen Nutzer. Entfernt samt
 * ungenutzter Pakete (express-session, memorystore, connect-pg-simple).
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
/** Code ohne Kommentare (Erklaerungen duerfen die alten Namen nennen) */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("keine Server-Sitzung", () => {
  it("weder express-session noch passport.session(); passport.initialize() bleibt fuer den Login", () => {
    const index = code(read("server/index.ts"));
    expect(index).not.toContain("express-session");
    expect(index).not.toContain("passport.session()");
    expect(index).toContain("app.use(passport.initialize());");
    // SESSION_SECRET bleibt geprueft: Ersatz fuer JWT_SECRET/CUSTOMER_JWT_SECRET
    expect(index).toContain('assertSecureSecret("SESSION_SECRET", process.env.SESSION_SECRET);');
  });

  it("kein req.logIn/req.session im Server, keine (De-)Serialisierung", () => {
    const files = (function walk(d: string): string[] {
      return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".ts") ? [path.join(d, e.name)] : []));
    })(path.join(ROOT, "server"));
    const hits = files.filter((f) => /req\.(logIn|login|session)\b|serializeUser|deserializeUser/.test(code(fs.readFileSync(f, "utf8"))));
    expect(hits.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("Sitzungspakete nicht mehr in den Abhaengigkeiten", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of ["express-session", "memorystore", "connect-pg-simple", "@types/express-session", "@types/connect-pg-simple"]) {
      expect(deps, name).not.toHaveProperty(name);
    }
  });
});
