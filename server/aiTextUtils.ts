import fs from "fs/promises";
import path from "path";

export function sanitizeDocumentText(text: string): string {
  if (!text) return text;
  const lines = text.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const lower = line.toLowerCase();
    if (lower.includes("ignore previous instructions")) return false;
    if (lower.includes("system prompt")) return false;
    if (lower.startsWith("assistant:")) return false;
    if (lower.startsWith("developer:")) return false;
    if (lower.startsWith("system:")) return false;
    return true;
  });
  return filtered.join("\n");
}

export function truncateText(text: string, maxChars: number): string {
  if (!text) return text;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

export function redactPII(text: string): string {
  if (!text) return text;
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\+?\d[\d\s()./-]{6,}\d/g, "[REDACTED_PHONE]")
    .replace(/\b(?:IBAN|DE)\s?[0-9A-Z]{10,}\b/gi, "[REDACTED_IBAN]");
}

export async function writeAIDebugSnapshot(
  payload: Record<string, unknown>,
  filenamePrefix: string
): Promise<void> {
  const dir = path.join(process.cwd(), "uploads", "ai-debug");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${filenamePrefix}-${Date.now()}.json`);
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf-8");
}
