/**
 * Bestätigungs-Mails des Onlineshops (server/shopContent/confirmationMails.ts):
 *   1. Newsletter-Double-Opt-in: Betreff, HTML und Text (deutsch)
 *   2. doppelte Double-Opt-in-Mails bei Gast-Bestellung und Registrierung: ältere Flows abschalten
 *   3. Mail-Kopf-/Fußzeile des Kanals META Regalbau DE: Rechtslinks, Registerangaben, Textfassung
 *
 * Ohne --apply nur Testlauf. Mit --apply Protokoll (Stand vorher) im Arbeitsverzeichnis; --revert stellt
 * Template, Flows und Kopf-/Fußzeile wieder her. Schreibt nur in Shops mit „test.“ in der URL, außer mit --live.
 * --only newsletter|flows|footer beschränkt auf einen Teil.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeConfirmationMails.ts <tenantId> [--apply] [--live] [--only …]
 *   NODE_ENV=development npx tsx scripts/writeConfirmationMails.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { readFileSync, writeFileSync } from "fs";
import { storage } from "../server/storage";
import {
  DOI_EVENTS,
  NEWSLETTER_DOI_HTML,
  NEWSLETTER_DOI_PLAIN,
  NEWSLETTER_DOI_SUBJECT,
  buildFooterHtml,
  buildFooterPlain,
  duplicateDoiFlows,
  headerWithLogoAlt,
  loadChannelHeaderFooter,
  loadNewsletterDoiTemplate,
  type FlowLite,
  type HeaderFooterDe,
  type MailTemplateDe,
} from "../server/shopContent/confirmationMails";
import { findDeChannel, shopApi } from "../server/shopContent/shopProducts";

type Part = "newsletter" | "flows" | "footer";
type Protocol = {
  tenantId: string;
  at: string;
  base: string;
  parts: Part[];
  template?: MailTemplateDe;
  flows?: Array<{ id: string; name: string; eventName: string; active: boolean }>;
  headerFooter?: HeaderFooterDe;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId || tenantId.startsWith("--")) {
    console.error("Usage: npx tsx scripts/writeConfirmationMails.ts <tenantId> [--apply] [--live] [--only newsletter|flows|footer] | --revert <protokoll.json>");
    process.exit(1);
  }
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const { api, base, isTest } = shopApi(settings);
  const live = process.argv.includes("--live");
  const guard = () => {
    if (!isTest && !live) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);
  };

  const revertFile = arg("--revert");
  if (revertFile) {
    const log = JSON.parse(readFileSync(revertFile, "utf8")) as Protocol;
    if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
    guard();
    if (log.template) {
      const { id, subject, contentHtml, contentPlain } = log.template;
      await api("PATCH", `mail-template/${id}`, { subject, contentHtml, contentPlain });
      console.log("Newsletter-Template zurückgesetzt");
    }
    for (const f of log.flows ?? []) {
      await api("PATCH", `flow/${f.id}`, { active: f.active });
      console.log(`Flow „${f.name}“ wieder ${f.active ? "aktiv" : "inaktiv"}`);
    }
    if (log.headerFooter) {
      const { id, headerHtml, footerHtml, footerPlain } = log.headerFooter;
      await api("PATCH", `mail-header-footer/${id}`, { headerHtml, footerHtml, footerPlain });
      console.log("Kopf-/Fußzeile zurückgesetzt");
    }
    console.log(`Stand ${log.at} wiederhergestellt`);
    return;
  }

  const only = arg("--only") as Part | undefined;
  const parts: Part[] = only ? [only] : ["newsletter", "flows", "footer"];
  const channel = await findDeChannel(api, base);
  console.log(`${base} · Kanal ${channel.name} · Storefront ${channel.domain}`);

  // 1. Newsletter-Double-Opt-in
  const template = parts.includes("newsletter") ? await loadNewsletterDoiTemplate(api) : undefined;
  const templateChanged =
    !!template &&
    (template.subject !== NEWSLETTER_DOI_SUBJECT || template.contentHtml !== NEWSLETTER_DOI_HTML || template.contentPlain !== NEWSLETTER_DOI_PLAIN);
  if (template) console.log(`Newsletter-DOI: „${template.subject}“ → „${NEWSLETTER_DOI_SUBJECT}“${templateChanged ? "" : " (schon aktuell)"}`);

  // 2. doppelte Flows
  let duplicates: FlowLite[] = [];
  if (parts.includes("flows")) {
    const res = await api("POST", "search/flow", {
      limit: 100,
      filter: [{ type: "equalsAny", field: "eventName", value: [...DOI_EVENTS] }],
      associations: { sequences: {} },
    });
    const flows: FlowLite[] = res?.data ?? [];
    for (const f of flows) console.log(`  Flow ${f.active ? "an " : "aus"} ${f.createdAt.slice(0, 10)} ${f.eventName} „${f.name}“`);
    duplicates = duplicateDoiFlows(flows);
    console.log(duplicates.length ? `Abschalten: ${duplicates.map((f) => `„${f.name}“`).join(", ")}` : "Keine doppelten Flows");
  }

  // 3. Kopf-/Fußzeile
  const hf = parts.includes("footer") ? await loadChannelHeaderFooter(api, channel.id) : undefined;
  const next = hf && {
    headerHtml: hf.headerHtml ? headerWithLogoAlt(hf.headerHtml) : hf.headerHtml,
    footerHtml: buildFooterHtml(channel.domain),
    footerPlain: buildFooterPlain(channel.domain),
  };
  const footerChanged = !!hf && !!next && (next.headerHtml !== hf.headerHtml || next.footerHtml !== hf.footerHtml || next.footerPlain !== hf.footerPlain);
  if (hf) console.log(`Kopf-/Fußzeile ${hf.id}: ${footerChanged ? "wird ersetzt" : "schon aktuell"}`);

  if (!templateChanged && !duplicates.length && !footerChanged) {
    console.log("Nichts zu tun");
    return;
  }
  if (!process.argv.includes("--apply")) {
    console.log("Testlauf – mit --apply schreiben");
    return;
  }
  guard();

  const log: Protocol = {
    tenantId,
    at: new Date().toISOString(),
    base,
    parts,
    template: templateChanged ? template : undefined,
    flows: duplicates.map((f) => ({ id: f.id, name: f.name, eventName: f.eventName, active: f.active })),
    headerFooter: footerChanged ? hf : undefined,
  };
  const file = `Bestaetigungs-Mails-Protokoll-${isTest ? "Testing" : "Live"}-${log.at.slice(0, 16).replace(":", "-")}.json`;
  writeFileSync(file, JSON.stringify(log, null, 2));
  console.log(`Protokoll: ${file}`);

  if (templateChanged && template) {
    await api("PATCH", `mail-template/${template.id}`, {
      subject: NEWSLETTER_DOI_SUBJECT,
      contentHtml: NEWSLETTER_DOI_HTML,
      contentPlain: NEWSLETTER_DOI_PLAIN,
    });
    console.log("Newsletter-Template geschrieben");
  }
  for (const f of duplicates) {
    await api("PATCH", `flow/${f.id}`, { active: false });
    console.log(`Flow „${f.name}“ abgeschaltet`);
  }
  if (footerChanged && hf && next) {
    await api("PATCH", `mail-header-footer/${hf.id}`, next);
    console.log("Kopf-/Fußzeile geschrieben");
  }
  console.log("Fertig");
}

main().then(() => process.exit(0), (e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
