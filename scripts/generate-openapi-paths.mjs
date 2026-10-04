/**
 * Extrahiert app.get/post/put/patch/delete("/api/...") aus allen Dateien unter server/
 * und schreibt server/openapi/openapi.paths.ts für die OpenAPI-Spezifikation.
 *
 * --check: schreibt nichts, sondern prueft, ob die eingecheckte Datei aktuell ist
 * (Exit-Code 1 mit Liste der Abweichungen) - laeuft in der PR-CI.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// Routen liegen verteilt (server/routes/*.ts, server/b2b/, server/erp/, server/sftp/, ...).
// Eine feste Dateiliste ist mehrfach still veraltet - deshalb ganz server/ durchsuchen.
function listTsFiles(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return listTsFiles(rel);
    return e.isFile() && e.name.endsWith(".ts") ? [rel] : [];
  });
}

const FILES = listTsFiles("server").sort();

const METHOD_RE = /app\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/gi;

function expressPathToOpenAPI(expressPath) {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function tagFromPath(openApiPath) {
  const m = openApiPath.match(/^\/api\/([^/]+)/);
  return m ? m[1] : "api";
}

/** Kein cookieAuth in der Spec (nur Dokumentation); echte Clients ohne Login. */
function isPublicRoute(method, openApiPath) {
  const m = method.toLowerCase();
  if (openApiPath === "/api/auth/login" && m === "post") return true;
  if (openApiPath.startsWith("/api/public/")) return true;
  return false;
}

function extractFromFile(content) {
  const found = [];
  const re = new RegExp(METHOD_RE.source, METHOD_RE.flags);
  let match;
  while ((match = re.exec(content)) !== null) {
    const method = match[1].toLowerCase();
    const expressPath = match[2];
    if (!expressPath.startsWith("/api")) continue;
    found.push({ method, expressPath });
  }
  return found;
}

const seen = new Set();
const operations = [];

for (const rel of FILES) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    console.warn("generate-openapi-paths: skip missing", full);
    continue;
  }
  const content = fs.readFileSync(full, "utf8");
  for (const { method, expressPath } of extractFromFile(content)) {
    const openApiPath = expressPathToOpenAPI(expressPath);
    const key = `${method} ${openApiPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    operations.push({ method, openApiPath });
  }
}

operations.sort(
  (a, b) =>
    a.openApiPath.localeCompare(b.openApiPath) || a.method.localeCompare(b.method),
);

const pathsObj = {};
for (const { method, openApiPath } of operations) {
  if (!pathsObj[openApiPath]) pathsObj[openApiPath] = {};
  const tag = tagFromPath(openApiPath);
  const op = {
    tags: [tag],
    summary: `${method.toUpperCase()} ${openApiPath}`,
    responses: {
      "200": {
        description: "OK",
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true },
          },
        },
      },
      "401": { description: "Nicht angemeldet oder ungültige Session" },
      "403": { description: "Fehlende Berechtigung oder CSRF/Origin abgelehnt" },
    },
  };
  if (isPublicRoute(method, openApiPath)) {
    op.security = [];
  }
  pathsObj[openApiPath][method] = op;
}

const dest = path.join(root, "server", "openapi", "openapi.paths.ts");
fs.mkdirSync(path.dirname(dest), { recursive: true });

const json = JSON.stringify(pathsObj, null, 2);
const ts = `/** AUTO-GENERATED — nicht manuell bearbeiten. Ausführen: \`npm run openapi:generate\`. */
export const openApiPaths = ${json} as const;
`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : "";
  if (current === ts) {
    console.log("openapi.paths.ts ist aktuell:", operations.length, "operations");
    process.exit(0);
  }
  // Abweichende Operationen benennen (falls sich die alte Datei lesen laesst)
  const opKeys = (paths) => new Set(Object.entries(paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`)));
  let detail = null;
  try {
    const old = JSON.parse(current.replace(/^[\s\S]*?export const openApiPaths = /, "").replace(/ as const;\s*$/, ""));
    const before = opKeys(old);
    const after = opKeys(pathsObj);
    detail = [
      ...[...after].filter((k) => !before.has(k)).map((k) => `  + ${k}`),
      ...[...before].filter((k) => !after.has(k)).map((k) => `  - ${k}`),
    ];
  } catch {
    // Datei fehlt oder ist nicht lesbar - detail bleibt null
  }
  const msg = "server/openapi/openapi.paths.ts ist veraltet. Bitte `npm run openapi:generate` ausfuehren und die Datei mit committen.";
  if (process.env.GITHUB_ACTIONS) console.log(`::error file=server/openapi/openapi.paths.ts::${msg}`);
  console.error(msg);
  if (detail === null) console.error("  (Datei fehlt oder ist nicht lesbar)");
  else if (detail.length > 0) console.error(detail.join("\n"));
  else console.error("  (Inhalt weicht ab, die Liste der Operationen ist gleich)");
  process.exit(1);
}

fs.writeFileSync(dest, ts, "utf8");
console.log(
  "openapi.paths.ts:",
  Object.keys(pathsObj).length,
  "paths,",
  operations.length,
  "operations",
);
