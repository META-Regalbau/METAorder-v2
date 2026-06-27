type SentryBrowserSdk = {
  init: (options: Record<string, unknown>) => void;
};

async function importSentryReact(): Promise<SentryBrowserSdk | null> {
  try {
    const dynamicImport = new Function("moduleName", "return import(moduleName);") as (
      moduleName: string
    ) => Promise<unknown>;
    return (await dynamicImport("@sentry/react")) as SentryBrowserSdk;
  } catch {
    return null;
  }
}

export async function initFrontendSentry(): Promise<void> {
  const dsn = (import.meta.env.VITE_SENTRY_DSN_FRONTEND ?? "").trim();
  if (!dsn) return;

  const sentry = await importSentryReact();
  if (!sentry) {
    console.warn("[monitoring] Sentry React SDK fehlt. TODO verify: `npm i @sentry/react` ausführen.");
    return;
  }

  sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE || "development",
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || "0.1"),
    release: import.meta.env.VITE_SENTRY_RELEASE || "unknown",
  });
}
