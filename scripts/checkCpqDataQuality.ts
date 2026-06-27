import { cpqStorage } from "../server/cpq/cpqStorage";
import { runCpqDataQualityCheck } from "../server/cpq-core/cpqObservability";

async function main(): Promise<void> {
  const tenantId = process.argv[2] ?? process.env.TENANT_ID;
  if (!tenantId) {
    console.error("Usage: npm run check:cpq-data-quality -- <tenantId>");
    process.exit(1);
  }

  const report = await runCpqDataQualityCheck(tenantId, cpqStorage);
  console.log(JSON.stringify(report, null, 2));

  if (report.summary.errors > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("CPQ data quality check failed:", message);
  process.exit(1);
});
