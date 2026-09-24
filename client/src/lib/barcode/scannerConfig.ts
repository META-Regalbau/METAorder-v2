import { Html5QrcodeSupportedFormats } from "html5-qrcode";
import { normalizeScanCode } from "./normalizeScanCode";

/** Symbologien, die META Order druckt bzw. an Fremdware vorkommen. */
export const SCANNER_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_39,
];

/**
 * Nutzt den nativen BarcodeDetector des Browsers, wenn vorhanden (Chrome/Android).
 * Der liest 1D-Codes deutlich zuverlaessiger als der ZXing-Fallback; ohne Unterstuetzung
 * (u. a. iOS Safari) faellt html5-qrcode automatisch auf ZXing zurueck.
 */
export const SCANNER_EXPERIMENTAL_FEATURES = { useBarCodeDetectorIfSupported: true };

/** Derselbe Code muss innerhalb dieser Zeit ein zweites Mal gelesen werden. */
const CONFIRM_MS = 1200;
/** Nach einem akzeptierten Scan denselben Code so lange nicht erneut melden. */
const DEDUP_MS = 1500;

/**
 * Scan-Bereich: bewusst breit und flach statt quadratisch.
 *
 * html5-qrcode dekodiert nur den Ausschnitt innerhalb der Box. Ein quadratischer
 * Ausschnitt schneidet bei einem Code128/EAN die Raender ab — der Decoder liefert dann
 * entweder nichts oder eine Fehl-Dekodierung (Zeichensalat). QR-Codes passen in den
 * breiten Streifen weiterhin problemlos.
 */
export function barcodeScanBox(
  viewfinderWidth: number,
  viewfinderHeight: number,
): { width: number; height: number } {
  const width = Math.floor(viewfinderWidth * 0.92);
  const height = Math.floor(
    Math.min(viewfinderHeight * 0.85, Math.max(120, Math.min(width * 0.55, viewfinderHeight * 0.5))),
  );
  return { width, height };
}

/**
 * Decode-Callback mit Bestaetigung: ein Code wird erst weitergereicht, wenn zwei
 * aufeinanderfolgende Lesungen denselben Wert liefern.
 *
 * 1D-Codes koennen bei feinem Druck oder schraegem Winkel falsch dekodiert werden —
 * das Ergebnis ist dann zufaelliger ASCII-Salat und unterscheidet sich von Frame zu
 * Frame. Zwei identische Lesungen hintereinander filtern das zuverlaessig heraus und
 * kosten bei 8 fps nur rund eine Achtelsekunde.
 */
export function createScanAcceptor(onAccept: (code: string) => void) {
  let pending: { code: string; at: number } | null = null;
  let accepted: { code: string; at: number } | null = null;

  return (decoded: string) => {
    const code = normalizeScanCode(decoded);
    if (!code) return;

    const now = Date.now();
    if (accepted && accepted.code === code && now - accepted.at < DEDUP_MS) return;

    if (!pending || pending.code !== code || now - pending.at > CONFIRM_MS) {
      pending = { code, at: now };
      return;
    }

    pending = null;
    accepted = { code, at: now };
    onAccept(code);
  };
}
