/**
 * Einmal-Aktion: Alle Shopware-Produkte mit Eigenschaft „Regal-Typ = Grundregal
 * oder Anbauregal" mit dem Tag „Montagekosten" versehen.
 *
 * Sicherheitsnetz: Ohne --apply nur Dry-Run (zeigt Options-/Produkt-Treffer und
 * was passieren würde). Tags werden ADDITIV geschrieben (Shopware-DAL: to-many-
 * Associations im Upsert erzeugen nur neue Join-Zeilen, bestehende Tags bleiben).
 *
 * Aufruf (Host, gegen lokale DB mit den Live-Credentials):
 *   DATABASE_URL=postgresql://metaorder:metaorder@127.0.0.1:5433/metaorder \
 *   ENCRYPTION_KEY=metaorder-dev-encryption-key-change-in-prod \
 *   npx tsx scripts/tagRegaltypMontagekosten.ts <tenantId> [--apply]
 */
import { randomBytes } from "crypto";
import { storage } from "../server/storage";

const TAG_NAME = "Montagekosten";
const OPTION_NAMES = ["Grundregal", "Anbauregal"];
const GROUP_NAME_PATTERN = /regal.?typ/i;

type SwSettings = { shopwareUrl: string; apiKey: string; apiSecret: string };

async function oauthToken(s: SwSettings): Promise<string> {
  const res = await fetch(`${s.shopwareUrl.replace(/\/$/, "")}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: s.apiKey,
      client_secret: s.apiSecret,
    }),
  });
  if (!res.ok) throw new Error(`OAuth fehlgeschlagen: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("OAuth: kein access_token");
  return data.access_token;
}

async function swPost<T = any>(base: string, token: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${(await res.text()).slice(0, 400)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

async function main(): Promise<void> {
  const tenantId = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!tenantId) {
    console.error("Usage: npx tsx scripts/tagRegaltypMontagekosten.ts <tenantId> [--apply]");
    process.exit(1);
  }

  const settings = (await storage.getShopwareSettings(tenantId)) as SwSettings | undefined;
  if (!settings?.shopwareUrl) throw new Error(`Keine Shopware-Settings für Tenant ${tenantId}`);
  const base = settings.shopwareUrl.replace(/\/$/, "");
  console.log(`Shopware: ${base} (${apply ? "APPLY" : "DRY-RUN"})`);

  const token = await oauthToken(settings);

  // 1) Eigenschafts-Optionen finden — inkl. Gruppe, um gleichnamige Optionen
  //    anderer Gruppen sicher auszuschließen.
  const optionSearch = await swPost(base, token, "/api/search/property-group-option", {
    limit: 50,
    filter: [{ type: "equalsAny", field: "name", value: OPTION_NAMES }],
    associations: { group: {} },
  });
  const allOptions = (optionSearch.data ?? []).map((o: any) => {
    const attrs = o.attributes ?? o;
    const group = o.group ?? attrs.group ?? {};
    const groupAttrs = group.attributes ?? group;
    return {
      id: String(o.id),
      name: String(attrs.name ?? attrs.translated?.name ?? ""),
      groupName: String(groupAttrs.name ?? groupAttrs.translated?.name ?? ""),
    };
  });
  console.log("Gefundene Optionen:", JSON.stringify(allOptions, null, 2));

  const matching = allOptions.filter((o: any) => GROUP_NAME_PATTERN.test(o.groupName));
  if (matching.length === 0) {
    throw new Error(
      `Keine Option in einer Gruppe passend zu ${GROUP_NAME_PATTERN} gefunden — Gruppennamen oben prüfen.`,
    );
  }
  const optionIds = matching.map((o: any) => o.id);
  console.log(`→ Verwende ${matching.length} Option(en) der Gruppe(n): ${[...new Set(matching.map((o: any) => o.groupName))].join(", ")}`);

  // 2) Alle Produkt-IDs mit diesen Eigenschaften (properties = Eigenschaften am Produkt,
  //    options = Varianten-Achsen — beide abdecken).
  const productIds: string[] = [];
  const pageSize = 500;
  for (let page = 1; ; page++) {
    const idsResp = await swPost(base, token, "/api/search-ids/product", {
      page,
      limit: pageSize,
      filter: [
        {
          type: "multi",
          operator: "or",
          queries: [
            { type: "equalsAny", field: "properties.id", value: optionIds },
            { type: "equalsAny", field: "options.id", value: optionIds },
          ],
        },
      ],
    });
    const ids: string[] = idsResp.data ?? [];
    productIds.push(...ids);
    if (ids.length < pageSize) break;
  }
  console.log(`Produkte mit Regal-Typ Grundregal/Anbauregal: ${productIds.length}`);

  // Beispiel-Produkte fürs Protokoll (Nummer + Name)
  if (productIds.length > 0) {
    const sample = await swPost(base, token, "/api/search/product", {
      limit: 10,
      ids: productIds.slice(0, 10),
      includes: { product: ["id", "productNumber", "name"] },
    });
    for (const p of sample.data ?? []) {
      const attrs = p.attributes ?? p;
      console.log(`  Beispiel: ${attrs.productNumber} — ${attrs.name}`);
    }
  }

  if (productIds.length === 0) {
    console.log("Nichts zu tun.");
    return;
  }

  // 3) Tag finden oder (nur bei --apply) anlegen
  const tagSearch = await swPost(base, token, "/api/search/tag", {
    limit: 10,
    filter: [{ type: "equals", field: "name", value: TAG_NAME }],
  });
  let tagId: string | null = tagSearch.data?.[0]?.id ? String(tagSearch.data[0].id) : null;
  console.log(tagId ? `Tag „${TAG_NAME}" existiert: ${tagId}` : `Tag „${TAG_NAME}" existiert noch nicht`);

  // Wie viele Produkte tragen den Tag bereits?
  if (tagId) {
    const already = await swPost(base, token, "/api/search-ids/product", {
      limit: 1,
      filter: [{ type: "equals", field: "tags.id", value: tagId }],
      "total-count-mode": 1,
    });
    console.log(`Produkte mit dem Tag aktuell: ${already.total ?? "?"}`);
  }

  if (!apply) {
    console.log(`\nDRY-RUN: Würde ${productIds.length} Produkte mit Tag „${TAG_NAME}" versehen. Mit --apply ausführen.`);
    return;
  }

  if (!tagId) {
    tagId = randomBytes(16).toString("hex");
    await swPost(base, token, "/api/tag", { id: tagId, name: TAG_NAME });
    console.log(`Tag angelegt: ${tagId}`);
  }

  // 4) Additiv taggen via Sync-API (Chunks à 100)
  const CHUNK = 100;
  let done = 0;
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const chunk = productIds.slice(i, i + CHUNK);
    await swPost(base, token, "/api/_action/sync", {
      "tag-products": {
        entity: "product",
        action: "upsert",
        payload: chunk.map((id) => ({ id, tags: [{ id: tagId }] })),
      },
    });
    done += chunk.length;
    console.log(`  getaggt: ${done}/${productIds.length}`);
  }

  // 5) Verifikation: Wie viele Produkte tragen den Tag jetzt?
  const after = await swPost(base, token, "/api/search-ids/product", {
    limit: 1,
    filter: [{ type: "equals", field: "tags.id", value: tagId }],
    "total-count-mode": 1,
  });
  console.log(`\nFERTIG. Produkte mit Tag „${TAG_NAME}" jetzt: ${after.total ?? "?"}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fehler:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
