import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { type Server } from "http";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

/**
 * Runtime-only dynamic import that esbuild cannot statically analyze,
 * keeping dev-only packages (vite, @vitejs/plugin-react, …) out of
 * the production bundle.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const _import = new Function("p", "return import(p)") as (
  p: string,
) => Promise<any>;

export async function setupVite(app: Express, server: Server) {
  const { createServer: createViteServer, createLogger } =
    await _import("vite");
  const { default: viteConfig } = await _import("../vite.config");

  const viteLogger = createLogger();

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg: string, options?: any) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: {
      middlewareMode: true,
      hmr: { server },
      allowedHosts: true as const,
    },
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${crypto.randomUUID()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const noStoreHtml =
    "no-store, no-cache, must-revalidate, proxy-revalidate, private, max-age=0";

  app.use(
    express.static(distPath, {
      setHeaders: (res, filepath) => {
        const rel = path.relative(distPath, filepath).replace(/\\/g, "/");
        if (rel === "index.html" || rel.endsWith("/index.html")) {
          res.setHeader("Cache-Control", noStoreHtml);
        } else if (rel.startsWith("assets/")) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }
    if (req.path.startsWith("/api")) {
      return next();
    }
    res.setHeader("Cache-Control", noStoreHtml);
    res.sendFile(path.resolve(distPath, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}
