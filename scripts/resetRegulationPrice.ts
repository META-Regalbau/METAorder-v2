import { storage } from "../server/storage";
import { ShopwareClient, type ShopwarePriceEntry } from "../server/shopware";

const SYNC_BATCH_SIZE = 100;
const DEFAULT_PAGE_SIZE = 500;
const MAX_DRY_RUN_SAMPLES = 5;

function parseArgs(argv: string[]): {
  tenantId: string | undefined;
  apply: boolean;
  pageSize: number;
} {
  let tenantId: string | undefined;
  let apply = false;
  let pageSize = DEFAULT_PAGE_SIZE;

  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      const n = Number.parseInt(arg.slice("--batch-size=".length), 10);
      if (Number.isFinite(n) && n > 0) {
        pageSize = n;
      }
      continue;
    }
    if (!arg.startsWith("-") && !tenantId) {
      tenantId = arg;
    }
  }

  return { tenantId, apply, pageSize };
}

function hasRegulationPrice(price: ShopwarePriceEntry[]): boolean {
  return price.some((entry) => entry.regulationPrice != null);
}

function clearRegulationPrice(price: ShopwarePriceEntry[]): ShopwarePriceEntry[] {
  return price.map((entry) => ({
    ...entry,
    regulationPrice: null,
  }));
}

async function flushBatch(
  client: ShopwareClient,
  batch: Array<{ id: string; price: ShopwarePriceEntry[] }>,
  apply: boolean
): Promise<void> {
  if (batch.length === 0) {
    return;
  }
  if (!apply) {
    return;
  }
  await client.bulkPatchProductPrices(batch);
}

async function main(): Promise<void> {
  const { tenantId: tenantIdArg, apply, pageSize } = parseArgs(process.argv.slice(2));
  const tenantId = tenantIdArg ?? process.env.TENANT_ID;

  if (!tenantId) {
    console.error("Usage: npm run reset:regulation-price -- <tenantId> [--apply] [--batch-size=500]");
    console.error("       TENANT_ID=<uuid> npm run reset:regulation-price [--apply]");
    process.exit(1);
  }

  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) {
    console.error(`Shopware settings not configured for tenant: ${tenantId}`);
    process.exit(1);
  }

  const client = new ShopwareClient(settings);

  const stats = {
    scanned: 0,
    withRegulationPrice: 0,
    updated: 0,
    failed: 0,
    pages: 0,
  };

  const dryRunSamples: Array<{ id: string; before: unknown; after: unknown }> = [];
  let pendingBatch: Array<{ id: string; price: ShopwarePriceEntry[] }> = [];

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        tenantId,
        pageSize,
        syncBatchSize: SYNC_BATCH_SIZE,
      },
      null,
      2
    )
  );

  try {
    for await (const row of client.iterateAllProductsForPriceReset(pageSize)) {
      stats.scanned += 1;

      if (!hasRegulationPrice(row.price)) {
        continue;
      }

      stats.withRegulationPrice += 1;
      const nextPrice = clearRegulationPrice(row.price);

      if (dryRunSamples.length < MAX_DRY_RUN_SAMPLES) {
        dryRunSamples.push({
          id: row.id,
          before: row.price,
          after: nextPrice,
        });
      }

      pendingBatch.push({ id: row.id, price: nextPrice });

      if (pendingBatch.length >= SYNC_BATCH_SIZE) {
        if (apply) {
          await flushBatch(client, pendingBatch, apply);
        }
        stats.updated += pendingBatch.length;
        pendingBatch = [];
      }
    }

    stats.pages = Math.max(1, Math.ceil(stats.scanned / pageSize));

    if (pendingBatch.length > 0) {
      if (apply) {
        await flushBatch(client, pendingBatch, apply);
      }
      stats.updated += pendingBatch.length;
    }

    console.log(JSON.stringify({ ...stats, dryRunSamples: apply ? undefined : dryRunSamples }, null, 2));

    if (!apply) {
      console.log(
        `\nDry-Run: ${stats.withRegulationPrice} Produkt(e) wuerden aktualisiert. Zum Anwenden: --apply`
      );
    }
  } catch (error) {
    stats.failed = pendingBatch.length;
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ ...stats, error: message }, null, 2));
    process.exit(2);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("reset-regulation-price failed:", message);
  process.exit(1);
});
