import fs from "fs";
import path from "path";
import { getUploadsRoot } from "../../uploadsRoot";
import { isSafeUploadBasename } from "../erpLogic";

export function shippingLabelsDir(): string {
  const dir = path.join(getUploadsRoot(), "shipping-labels");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function labelRelativePath(labelId: string): string {
  if (!isSafeUploadBasename(labelId)) {
    throw new Error("Invalid label id for file path");
  }
  return path.join("shipping-labels", `${labelId}.pdf`);
}

export function labelAbsolutePath(relativeOrAbsolute: string): string {
  if (path.isAbsolute(relativeOrAbsolute)) return relativeOrAbsolute;
  return path.join(getUploadsRoot(), relativeOrAbsolute);
}

export async function writeLabelPdf(labelId: string, pdf: Buffer): Promise<string> {
  const rel = labelRelativePath(labelId);
  const abs = labelAbsolutePath(rel);
  await fs.promises.writeFile(abs, pdf);
  return rel;
}
