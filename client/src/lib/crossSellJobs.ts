import i18next from "i18next";
import { apiRequest } from "@/lib/queryClient";

// Wartet auf einen Cross-Sell-Hintergrundjob (Staging-Neuberechnung / AI-Lernlauf).
// Der POST startet den Job (202) und dieser Poller fragt den Status ab, bis er
// "done" oder "error" ist. Vermeidet Proxy-/Browser-Timeouts bei grossen Laeufen.
export async function pollCrossSellJob(
  type: "staging" | "ai" | "import" | "candidates",
  onProgress?: (processed: number, total: number) => void,
): Promise<any> {
  const maxAttempts = 720; // ~30 min bei 2.5s Intervall
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const resp = await apiRequest("GET", `/api/cross-selling/jobs/status?type=${type}`);
    const data = await resp.json();
    if (typeof data.processed === "number" && typeof data.total === "number") {
      onProgress?.(data.processed, data.total);
    }
    if (data.status === "done") return data.result ?? {};
    if (data.status === "error") {
      throw new Error(
        data.code === "interrupted"
          ? i18next.t("crossSelling.job.interrupted")
          : data.error || i18next.t("crossSelling.job.failed"),
      );
    }
    if (data.status === "idle") throw new Error(i18next.t("crossSelling.job.notFound"));
  }
  throw new Error(i18next.t("crossSelling.job.timeout"));
}

