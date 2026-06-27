/**
 * Test: Stücklistenberechnung mit vorhandenen CPQ-Daten
 * Führt resolveBillOfMaterials mit echten Systemen, Komponententypen und Mappings aus.
 *
 * Ausführung: npm run test:bom
 * Lädt .env (falls vorhanden) und nutzt DATABASE_URL bzw. PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
 */

import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
loadEnv({ path: resolve(projectRoot, "docker.env") });
loadEnv({ path: resolve(projectRoot, ".env") });
loadEnv({ path: resolve(projectRoot, ".env.local") });

// "db" ist Docker-Service-Name; außerhalb von Docker → localhost (bei Port-Forward)
const dbHost =
  process.env.PGHOST === "db"
    ? process.env.DB_HOST_LOCAL || "localhost"
    : process.env.PGHOST || "localhost";

// DATABASE_URL auf localhost umbiegen, wenn sie @db: enthält (Docker-Host)
if (process.env.DATABASE_URL?.includes("@db:")) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace("@db:", `@${dbHost}:`);
}

// DATABASE_URL aus Einzelvariablen bauen, falls nicht gesetzt (wie bei test-shopware-auth.js etc.)
if (!process.env.DATABASE_URL) {
  const port = process.env.PGPORT || "5432";
  const user = process.env.PGUSER || "metaorder";
  const password = process.env.PGPASSWORD || "metaorder";
  const database = process.env.PGDATABASE || "metaorder";
  process.env.DATABASE_URL = `postgresql://${user}:${password}@${dbHost}:${port}/${database}`;
  if (process.env.PGHOST === undefined && process.env.PGUSER === undefined) {
    console.warn(
      "Hinweis: Keine .env gefunden. Erstelle .env mit DATABASE_URL oder PGHOST/PGUSER/PGPASSWORD/PGDATABASE, damit die richtige DB verwendet wird.\n"
    );
  }
}

// dynamischer Import, damit DATABASE_URL-Check vor DB-Verbindung läuft
const { cpqStorage } = await import("../server/cpq/cpqStorage");
const { resolveBillOfMaterials } = await import("../server/cpq/cpqBillOfMaterials");
const { productCache } = await import("../server/productCache");

const SAMPLE_CONFIG = {
  height: 2500,
  depth: 800,
  field_count: 4,
  level_count: 5,
};

async function main() {
  console.log("=== Test: Stücklistenberechnung ===\n");

  // 1. Systeme laden
  const systems = await cpqStorage.getSystems(null);
  console.log(`Systeme: ${systems.length}`);
  if (systems.length === 0) {
    console.log("  -> Keine Systeme vorhanden. Bitte im CPQ Admin unter Tab 'Systeme' ein System anlegen.");
    return;
  }
  systems.forEach((s) => console.log(`  - ${s.name} (id: ${s.id})`));

  // 2. Product Cache Status
  const cacheStatus = productCache.getStatus();
  console.log(`\nProduct Cache: ${cacheStatus.productCount} Produkte, isPopulated: ${cacheStatus.isPopulated}`);
  if (!cacheStatus.isPopulated) {
    console.log("  -> Cache leer. Stückliste wird fehlschlagen (Produkte nicht im Katalog).");
    console.log("  -> Bitte Shopware-Sync ausführen (Admin > Einstellungen > Shopware).");
  }

  // 3. Pro System: Komponententypen, Mappings, BOM-Test
  for (const system of systems) {
    console.log(`\n--- System: ${system.name} ---`);

    const componentTypes = await cpqStorage.getComponentTypesBySystem(system.id);
    const mappings = await cpqStorage.getProductMappingsBySystem(system.id, null);
    const activeMappings = mappings.filter((m) => m.status === "active");

    console.log(`  Komponententypen: ${componentTypes.length}`);
    componentTypes.forEach((ct) => {
      const count = activeMappings.filter((m) => m.componentTypeId === ct.id).length;
      console.log(`    - ${ct.name} (Rolle: "${ct.role}") – ${count} Mapping(s)`);
    });

    console.log(`  Mappings gesamt: ${mappings.length}, davon aktiv: ${activeMappings.length}`);
    activeMappings.slice(0, 5).forEach((m) => {
      const p = productCache.getProductByNumber(m.shopwareProductNumber);
      const inCache = p ? "✓" : "✗";
      console.log(`    - ${m.shopwareProductNumber} (${m.productName ?? "—"}) [im Cache: ${inCache}]`);
    });
    if (activeMappings.length > 5) {
      console.log(`    ... und ${activeMappings.length - 5} weitere`);
    }

    if (componentTypes.length === 0) {
      console.log("  -> Keine Komponententypen. BOM-Test übersprungen.");
      continue;
    }
    if (activeMappings.length === 0) {
      console.log("  -> Keine aktiven Mappings. BOM-Test übersprungen.");
      continue;
    }

    const rules = await cpqStorage.getRulesBySystem(system.id, null);
    const getProduct = (productNumber: string) => {
      const p = productCache.getProductByNumber(productNumber);
      return p
        ? { id: p.id, name: p.name ?? productNumber, price: p.price ?? 0, dimensions: p.dimensions }
        : undefined;
    };

    console.log(`  Regeln: ${rules.length}`);
    console.log("  Config:", JSON.stringify(SAMPLE_CONFIG, null, 2));

    try {
      const bom = await resolveBillOfMaterials(
        system.id,
        SAMPLE_CONFIG,
        componentTypes,
        mappings,
        rules,
        getProduct
      );

      console.log("\n  Stücklisten-Ergebnis:");
      console.log(`    Positionen: ${bom.items.length}`);
      console.log(`    Fehler: ${bom.errors.length}`);
      console.log(`    Warnungen: ${bom.warnings.length}`);

      if (bom.errors.length > 0) {
        bom.errors.forEach((e) => console.log(`    [FEHLER] ${e}`));
      }
      if (bom.warnings.length > 0) {
        bom.warnings.forEach((w) => console.log(`    [WARNUNG] ${w}`));
      }
      if (bom.items.length > 0) {
        console.log("    Positionen:");
        bom.items.forEach((item, i) => {
          console.log(`      ${i + 1}. ${item.productNumber} – ${item.name} | Menge: ${item.quantity} | ${item.unitPrice.toFixed(2)} €`);
        });
        console.log(`    Gesamtpreis: ${bom.totalPrice.toFixed(2)} €`);
      }
    } catch (err) {
      console.error("  BOM-Fehler:", err);
    }
  }

  console.log("\n=== Test beendet ===");
}

main().catch((e) => {
  console.error("Script-Fehler:", e);
  process.exit(1);
});
