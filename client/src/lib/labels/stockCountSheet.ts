/**
 * Inventur-Zählliste als druckfertiges A4-Dokument.
 *
 * Der Druck läuft über ein verstecktes iframe statt window.open: kein Popup-Blocker, und das
 * Dokument ist vollständig eigenständig (kein Tailwind, keine App-Styles), sodass der Ausdruck
 * unabhängig vom Theme immer gleich aussieht. QR-Codes werden als data:-URI eingebettet —
 * die CSP erlaubt img-src data:.
 */

import bwipjs from "bwip-js/browser";

export type StockCountRow = {
  productNumber: string;
  name: string | null;
  size: string | null;
  color: string | null;
  /** Lagerplatz-Code, falls dem Artikel einer zugewiesen ist. */
  locationCode: string | null;
  /** Soll-Bestand aus dem ERP. */
  erpQty: number;
};

export type StockCountSheetOptions = {
  warehouseLabel: string;
  /** Überschrift, z. B. "Inventur-Zählliste". */
  title: string;
  /** Feldbeschriftungen, damit die Sprache aus i18n kommt. */
  labels: {
    productNumber: string;
    description: string;
    location: string;
    erpQty: string;
    counted: string;
    date: string;
    page: string;
    rowCount: string;
    note: string;
  };
  /** Zeitpunkt der Erstellung (aus dem Aufrufer, nicht hier gestempelt). */
  printedAt: Date;
};

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function variantLine(size: string | null, color: string | null): string {
  return [size, color].map((p) => (p || "").trim()).filter(Boolean).join(" · ");
}

/** QR als PNG-data-URI. Bei einem Fehler leerer String — die Zeile bleibt trotzdem nutzbar. */
function qrDataUrl(text: string): string {
  try {
    const canvas = document.createElement("canvas");
    bwipjs.toCanvas(canvas, {
      bcid: "qrcode",
      text,
      scale: 3,
      includetext: false,
    });
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

export function buildStockCountSheetHtml(
  rows: StockCountRow[],
  opts: StockCountSheetOptions,
): string {
  const { labels } = opts;
  const qtyFmt = new Intl.NumberFormat("de-DE");

  const body = rows
    .map((row) => {
      const qr = qrDataUrl(row.productNumber);
      const variant = variantLine(row.size, row.color);
      return `<tr>
  <td class="qr">${qr ? `<img src="${qr}" alt="" />` : ""}</td>
  <td class="sku">${escapeHtml(row.productNumber)}</td>
  <td class="desc">
    <div>${escapeHtml(row.name || "—")}</div>
    ${variant ? `<div class="variant">${escapeHtml(variant)}</div>` : ""}
  </td>
  <td class="loc">${escapeHtml(row.locationCode || "—")}</td>
  <td class="num">${escapeHtml(qtyFmt.format(row.erpQty))}</td>
  <td class="count"></td>
  <td class="note"></td>
</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(opts.title)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm 8mm 12mm 8mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    font-size: 9pt;
    color: #000;
    margin: 0;
  }
  header { margin-bottom: 4mm; }
  h1 { font-size: 14pt; margin: 0 0 1mm 0; }
  .meta { font-size: 8pt; color: #444; display: flex; gap: 6mm; flex-wrap: wrap; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th, td {
    border: 0.4pt solid #999;
    padding: 1.2mm 1.5mm;
    text-align: left;
    vertical-align: middle;
  }
  th { background: #eee; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.02em; }
  td.qr { width: 16mm; padding: 1mm; }
  td.qr img { display: block; width: 14mm; height: 14mm; }
  td.sku { width: 30mm; font-family: "SFMono-Regular", Consolas, monospace; font-weight: 600; }
  td.desc { }
  td.desc .variant { font-size: 8pt; color: #555; }
  td.loc { width: 24mm; font-family: "SFMono-Regular", Consolas, monospace; }
  td.num { width: 16mm; text-align: right; font-variant-numeric: tabular-nums; }
  td.count { width: 22mm; background: #fafafa; }
  td.note { width: 30mm; }
  tfoot td { border: 0; font-size: 8pt; color: #444; padding-top: 3mm; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(opts.title)}</h1>
  <div class="meta">
    <span>${escapeHtml(opts.warehouseLabel)}</span>
    <span>${escapeHtml(labels.date)}: ${escapeHtml(opts.printedAt.toLocaleString("de-DE"))}</span>
    <span>${escapeHtml(labels.rowCount)}: ${rows.length}</span>
  </div>
</header>
<table>
  <thead>
    <tr>
      <th>QR</th>
      <th>${escapeHtml(labels.productNumber)}</th>
      <th>${escapeHtml(labels.description)}</th>
      <th>${escapeHtml(labels.location)}</th>
      <th>${escapeHtml(labels.erpQty)}</th>
      <th>${escapeHtml(labels.counted)}</th>
      <th>${escapeHtml(labels.note)}</th>
    </tr>
  </thead>
  <tbody>
${body}
  </tbody>
</table>
</body>
</html>`;
}

/**
 * Zählliste drucken. Öffnet den Druckdialog des Browsers für ein temporäres iframe und
 * entfernt es danach wieder.
 */
export function printStockCountSheet(rows: StockCountRow[], opts: StockCountSheetOptions): void {
  const html = buildStockCountSheetHtml(rows, opts);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    throw new Error("Print frame could not be created");
  }

  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    // Nicht sofort entfernen: Safari bricht den Druck ab, wenn das iframe während des
    // Dialogs verschwindet.
    window.setTimeout(() => iframe.remove(), 1000);
  };

  win.addEventListener("afterprint", cleanup);

  doc.open();
  doc.write(html);
  doc.close();

  // Bilder (QR-data-URIs) müssen geladen sein, sonst druckt Chrome leere Kästen.
  const start = () => {
    try {
      win.focus();
      win.print();
    } finally {
      // Fallback, falls afterprint nicht feuert (z. B. Firefox in manchen Versionen)
      window.setTimeout(cleanup, 60_000);
    }
  };

  if (doc.readyState === "complete") {
    start();
  } else {
    win.addEventListener("load", start, { once: true });
  }
}
