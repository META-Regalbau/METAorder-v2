/**
 * Importiert .eml-Dateien als Commercial-Agent-Few-Shot-Exemplare (Tabelle commercial_agent_exemplars).
 * Genutzt für Intent-Klassifikation (quote_request vs. purchase_order), siehe commercialDocumentIntent.ts.
 *
 * Voraussetzungen für DB-Import:
 *   DATABASE_URL, Mandant (--tenant=UUID), Dokumenten-Lernen in den Einstellungen aktiv (wird nicht hier geprüft).
 *
 * Beispiele:
 *   # Nur prüfen
 *   npx tsx scripts/ingestCommercialAgentEmailExemplars.ts --dry-run --tenant=… \
 *     "/pfad/Angebotsanfragen" "/pfad/Bestellanfragen"
 *
 *   # JSONL für Review (ohne DB)
 *   npx tsx scripts/ingestCommercialAgentEmailExemplars.ts --export-jsonl=training/commercial-agent/exports/review.jsonl \
 *     "/pfad/Angebotsanfragen"
 *
 *   # Import
 *   npm run commercial-agent:import-eml -- --tenant=… "/pfad/Angebotsanfragen/Mail-Anhang.eml"
 *
 * Intent: Ordnername „Angebotsanfragen“ → quote_request, „Bestellanfragen“ → purchase_order;
 * sonst --intent=quote_request|purchase_order setzen.
 */
import dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { simpleParser } from "mailparser";
import { commercialAgentExemplars } from "../shared/schema";
import { trimExcerpt } from "../server/commercialAgentLearning";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), "docker.env") });
dotenv.config();

type IntentLabel = "quote_request" | "purchase_order";

function inferIntentFromPath(filePath: string): IntentLabel | null {
  const lower = filePath.toLowerCase();
  if (lower.includes("bestellanfragen") || lower.includes("bestell")) return "purchase_order";
  if (lower.includes("angebotsanfragen") || lower.includes("angebots")) return "quote_request";
  return null;
}

function parseArgs(argv: string[]) {
  const paths: string[] = [];
  let tenant: string | undefined;
  let intent: IntentLabel | undefined;
  let dryRun = false;
  let exportJsonl: string | undefined;
  let quality = 16;
  for (const a of argv) {
    if (a.startsWith("--tenant=")) tenant = a.slice("--tenant=".length).trim();
    else if (a.startsWith("--intent=")) {
      const v = a.slice("--intent=".length).trim();
      if (v === "quote_request" || v === "purchase_order") intent = v;
      else throw new Error(`Ungültiges --intent: ${v}`);
    } else if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--export-jsonl="))
      exportJsonl = a.slice("--export-jsonl=".length).trim();
    else if (a.startsWith("--quality=")) quality = Math.min(20, Math.max(1, Number(a.slice("--quality=".length)) || 16));
    else if (!a.startsWith("-")) paths.push(a);
  }
  return { paths, tenant, intent, dryRun, exportJsonl, quality };
}

async function collectEmlFiles(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  async function walk(p: string) {
    const s = await fs.stat(p).catch(() => null);
    if (!s) return;
    if (s.isDirectory()) {
      const entries = await fs.readdir(p, { withFileTypes: true });
      for (const e of entries) await walk(path.join(p, e.name));
    } else if (p.toLowerCase().endsWith(".eml")) out.push(p);
  }
  for (const p of paths) await walk(p);
  return [...new Set(out)].sort();
}

function htmlToRoughText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function parseEml(filePath: string): Promise<{ subject: string; body: string }> {
  const raw = await fs.readFile(filePath);
  const parsed = await simpleParser(raw);
  const subject = (parsed.subject || "").trim() || "(ohne Betreff)";
  const text = (parsed.text || "").trim();
  const body =
    text ||
    (parsed.html ? htmlToRoughText(typeof parsed.html === "string" ? parsed.html : parsed.html.toString()) : "");
  return { subject, body: body || "(leer)" };
}

async function main() {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e: unknown) {
    console.error((e as Error).message);
    process.exit(1);
  }

  if (!args.paths.length) {
    console.error(
      "Usage: npx tsx scripts/ingestCommercialAgentEmailExemplars.ts [--tenant=UUID] [--intent=quote_request|purchase_order] [--dry-run] [--export-jsonl=pfad.jsonl] [--quality=1-20] <pfad.eml|ordner> …",
    );
    process.exit(1);
  }

  const files = await collectEmlFiles(args.paths);
  if (!files.length) {
    console.error("Keine .eml-Dateien gefunden.");
    process.exit(1);
  }

  type Row = {
    tenantId: string;
    sourceKind: string;
    intentLabel: IntentLabel;
    subjectExcerpt: string | null;
    emailExcerpt: string | null;
    pdfExcerpt: null;
    signalsJson: Record<string, unknown>;
    qualityScore: number;
    draftKind: "offer" | "order";
    referenceDraftId: null;
  };

  const rows: Row[] = [];

  for (const filePath of files) {
    const intent = args.intent ?? inferIntentFromPath(filePath);
    if (!intent) {
      console.error(
        `Intent für „${filePath}“ nicht ermittelbar. Bitte --intent=quote_request oder purchase_order setzen.`,
      );
      process.exit(1);
    }
    const { subject, body } = await parseEml(filePath);
    const draftKind: "offer" | "order" = intent === "purchase_order" ? "order" : "offer";
    rows.push({
      tenantId: args.tenant || "",
      sourceKind: "eml_curated_import",
      intentLabel: intent,
      subjectExcerpt: trimExcerpt(subject, 500) || null,
      emailExcerpt: trimExcerpt(body, 6000) || null,
      pdfExcerpt: null,
      signalsJson: {
        sourceFile: path.basename(filePath),
        sourcePathHint: path.dirname(filePath).slice(-80),
      },
      qualityScore: args.quality,
      draftKind,
      referenceDraftId: null,
    });
  }

  if (args.exportJsonl) {
    await fs.mkdir(path.dirname(args.exportJsonl), { recursive: true });
    const ws = createWriteStream(args.exportJsonl, { flags: "w" });
    for (const r of rows) {
      ws.write(JSON.stringify({ ...r, tenantId: args.tenant || null }) + "\n");
    }
    ws.end();
    await new Promise<void>((res, rej) => {
      ws.on("finish", () => res());
      ws.on("error", rej);
    });
    console.log(`JSONL geschrieben: ${args.exportJsonl} (${rows.length} Zeilen)`);
    return;
  }

  if (!args.tenant) {
    console.error("Fehler: --tenant=<Mandanten-UUID> ist für den DB-Import erforderlich (oder --export-jsonl nutzen).");
    process.exit(1);
  }

  for (const r of rows) r.tenantId = args.tenant!;

  if (args.dryRun) {
    console.log(`Dry-run: ${rows.length} Exemplare (kein DB-Schreibzugriff).`);
    for (const r of rows) {
      console.log("---");
      console.log(JSON.stringify({ ...r, emailExcerpt: (r.emailExcerpt || "").slice(0, 200) + "…" }, null, 2));
    }
    return;
  }

  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL fehlt. .env.local / docker.env setzen oder --export-jsonl verwenden.");
    process.exit(1);
  }

  const { db } = await import("../server/db");
  for (const r of rows) {
    await db.insert(commercialAgentExemplars).values({
      tenantId: r.tenantId,
      sourceKind: r.sourceKind,
      intentLabel: r.intentLabel,
      subjectExcerpt: r.subjectExcerpt,
      emailExcerpt: r.emailExcerpt,
      pdfExcerpt: r.pdfExcerpt,
      signalsJson: r.signalsJson,
      qualityScore: r.qualityScore,
      draftKind: r.draftKind,
      referenceDraftId: r.referenceDraftId,
    });
  }
  console.log(`Importiert: ${rows.length} Exemplare für tenant=${args.tenant}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
