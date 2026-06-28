/**
 * METAorder App-Icons aus SVG → PNG (client/public).
 * Aufruf: node scripts/generate-app-icons.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "client", "public");

const targets = [
  { svg: "favicon.svg", out: "favicon-16.png", size: 16 },
  { svg: "favicon.svg", out: "favicon-32.png", size: 32 },
  { svg: "favicon.svg", out: "favicon.png", size: 48 },
  { svg: "app-icon.svg", out: "apple-touch-icon.png", size: 180 },
  { svg: "app-icon.svg", out: "icon-192.png", size: 192 },
  { svg: "app-icon.svg", out: "icon-512.png", size: 512 },
  { svg: "app-icon-maskable.svg", out: "icon-512-maskable.png", size: 512 },
];

function renderPng(svgPath, size) {
  const svg = fs.readFileSync(svgPath);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
  });
  return resvg.render().asPng();
}

for (const { svg, out, size } of targets) {
  const svgPath = path.join(publicDir, svg);
  const outPath = path.join(publicDir, out);
  const buf = renderPng(svgPath, size);
  fs.writeFileSync(outPath, buf);
  console.log(`Wrote ${out} (${size}x${size}, ${buf.length} bytes)`);
}
