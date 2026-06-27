/**
 * Nach esbuild: pdfAssets neben dist/index.js, damit readMetaRegalbauLogo() unter __dirname=dist findet.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const srcDir = path.join(root, "server", "pdfAssets");
const destDir = path.join(root, "dist", "pdfAssets");

if (!fs.existsSync(srcDir)) {
  console.warn("copy-pdf-assets: skip, missing", srcDir);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
for (const name of fs.readdirSync(srcDir)) {
  const from = path.join(srcDir, name);
  if (!fs.statSync(from).isFile()) continue;
  fs.copyFileSync(from, path.join(destDir, name));
}
console.log("copy-pdf-assets:", destDir);
