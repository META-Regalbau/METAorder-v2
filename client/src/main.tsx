import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { beginGlobalLoading, endGlobalLoading } from "@/lib/globalLoading";
import { initFrontendSentry } from "@/lib/sentry";

const DEBUG_INGEST_ORIGIN = "http://127.0.0.1:7242";
const DEBUG_INGEST_PATH = "/ingest/9d6671c7-ddfc-4021-9e32-b7b0d717e420";

const originalFetch = window.fetch.bind(window);

/**
 * Erkennt Uploads mit `FormData`-Body. Dort darf der Monkey-Patch NICHT mit
 * synchronen `notify()`-Calls in den Body-Stream funken — Safari/WebKit
 * bricht sonst gelegentlich mit „Request body stream exhausted" ab. Ebenso
 * für `Blob` / `ReadableStream`-Bodies (große Uploads, EventSource o.ä.).
 */
function isStreamingBody(init?: RequestInit): boolean {
  const body = init?.body;
  if (!body) return false;
  if (typeof FormData !== "undefined" && body instanceof FormData) return true;
  if (typeof Blob !== "undefined" && body instanceof Blob) return true;
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) return true;
  return false;
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith(`${DEBUG_INGEST_ORIGIN}${DEBUG_INGEST_PATH}`)) {
    const remapped = url.replace(DEBUG_INGEST_ORIGIN, "");
    return originalFetch(remapped, init);
  }

  if (isStreamingBody(init)) {
    return originalFetch(input, init);
  }

  beginGlobalLoading();
  try {
    return await originalFetch(input, init);
  } finally {
    endGlobalLoading();
  }
};

createRoot(document.getElementById("root")!).render(<App />);
void initFrontendSentry();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service Worker registration failed:", error);
    });
  });
}
