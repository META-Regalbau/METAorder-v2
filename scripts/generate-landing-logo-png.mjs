/**
 * Einmalig / bei Logo-Änderung: META-Logo.svg (Landingpage) → PNG für PDFKit (server/pdfAssets).
 * Aufruf: node scripts/generate-landing-logo-png.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const svgPath = path.join(root, "attached_assets", "META-Logo.svg");
const outPath = path.join(root, "server", "pdfAssets", "META-Logo-landing.png");

const svg = fs.readFileSync(svgPath);
const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 400 },
});
const png = resvg.render();
const buf = png.asPng();
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buf);
console.log("Wrote", outPath, `(${buf.length} bytes)`);
