/**
 * Extrahiert app.get/post/put/patch/delete("/api/...") aus den Server-Routen
 * und schreibt server/openapi/openapi.paths.ts für die OpenAPI-Spezifikation.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const FILES = [
  "server/routes.ts",
  "server/cpq/cpqRoutes.ts",
  "server/cpq-core/cpqCoreRoutes.ts",
  "server/publicOfferRoutes.ts",
];

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

fs.writeFileSync(dest, ts, "utf8");
console.log(
  "openapi.paths.ts:",
  Object.keys(pathsObj).length,
  "paths,",
  operations.length,
  "operations",
);
