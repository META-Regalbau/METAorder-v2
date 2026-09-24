import type { Html5Qrcode } from "html5-qrcode";

/**
 * Kamera-Scanner sicher beenden.
 *
 * html5-qrcode wirft `stop()` **synchron** ("Cannot stop, scanner is not running
 * or paused."), wenn der Start vorher fehlgeschlagen ist (keine Kamera, Berechtigung
 * abgelehnt, kein sicherer Kontext). Passiert das im Cleanup eines useEffect, reisst
 * die Exception den kompletten React-Baum ab — die App zeigt dann eine weisse Seite.
 * Deshalb hier alles abfangen: stop() synchron *und* als Promise, danach clear().
 */
export function stopBarcodeScanner(scanner: Html5Qrcode | null | undefined): void {
  if (!scanner) return;

  const safeClear = () => {
    try {
      scanner.clear();
    } catch {
      // Ziel-Element ist evtl. schon aus dem DOM — nichts mehr aufzuraeumen.
    }
  };

  try {
    const stopped = scanner.stop() as unknown;
    if (stopped && typeof (stopped as Promise<void>).then === "function") {
      void (stopped as Promise<void>).then(safeClear, safeClear);
    } else {
      safeClear();
    }
  } catch {
    safeClear();
  }
}
