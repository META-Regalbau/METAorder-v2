import type { Express, RequestHandler } from "express";
import * as swaggerUi from "swagger-ui-express";
import fs from "fs";
import path from "path";
import { openApiPaths } from "./openapi.paths.js";

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "1.0.0";
  } catch {
    return "1.0.0";
  }
}

function buildOpenApiSpec() {
  const paths = JSON.parse(JSON.stringify(openApiPaths)) as Record<
    string,
    Record<string, unknown>
  >;

  return {
    openapi: "3.0.3",
    info: {
      title: "METAorder API",
      version: readPackageVersion(),
      description:
        "REST-API für METAorder. Geschützte Endpunkte erwarten das httpOnly-Cookie `auth_token` (nach Login). " +
        "Bei POST, PUT, PATCH und DELETE zusätzlich den Header `X-CSRF-Token` mit dem Wert aus dem Cookie `csrf_token` senden (gleiche Origin wie die App). " +
        "Für **Maschinen-Clients** (z. B. n8n): `Authorization: Bearer <JWT>` nach `POST /api/auth/login` — ohne Browser-Cookies; viele reine API-Routen (z. B. Commercial-Draft-Upload, Create-Offer/Order) **ohne** CSRF. " +
        "Optional: `X-METAORDER-Integration-Key` wenn `METAORDER_INTEGRATION_API_KEY` gesetzt ist (siehe `docs/docker.md`, `docs/n8n-commercial-integration.md`). " +
        "Die Swagger-UI und `/api/openapi.json` sind nur für angemeldete Nutzer erreichbar.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "auth_token",
          description: "JWT nach erfolgreichem POST /api/auth/login (httpOnly).",
        },
        integrationApiKey: {
          type: "apiKey",
          in: "header",
          name: "X-METAORDER-Integration-Key",
          description:
            "Nur wenn der Server `METAORDER_INTEGRATION_API_KEY` setzt. Ersetzt nicht die Benutzeridentität: Requests laufen als konfigurierter Integrations-User (Standard: n8n-service).",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT aus POST /api/auth/login (Feld token), für API-Clients ohne Cookies.",
        },
      },
      parameters: {
        CsrfToken: {
          name: "X-CSRF-Token",
          in: "header",
          required: false,
          schema: { type: "string" },
          description:
            "Bei schreibenden Requests erforderlich: Wert des Cookies `csrf_token`.",
        },
      },
    },
    security: [{ cookieAuth: [] }],
    paths,
  };
}

let cachedSpec: ReturnType<typeof buildOpenApiSpec> | null = null;

function getSpec() {
  if (!cachedSpec) cachedSpec = buildOpenApiSpec();
  return cachedSpec;
}

export function registerOpenApi(
  app: Express,
  requireAuth: RequestHandler,
): void {
  const spec = getSpec();

  app.get("/api/openapi.json", requireAuth, (_req, res) => {
    res.json(spec);
  });

  app.use(
    "/api/docs",
    requireAuth,
    ...swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: "METAorder API",
      swaggerOptions: {
        persistAuthorization: true,
        withCredentials: true,
      },
    }),
  );
}
