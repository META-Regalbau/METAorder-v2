import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Order } from "@shared/schema";
import { parseTrackingCodes } from "@shared/tracking";
import { cn } from "@/lib/utils";

/**
 * Sendungsnummern einer Bestellung, jede einzeln; mit Link zur Sendungsverfolgung, wenn die
 * Versandart in Shopware eine Tracking-URL hat (z. B. DPD). Ohne Nummer nichts.
 */
export default function TrackingCodes({
  shippingInfo,
  className,
  testId,
}: {
  shippingInfo: Order["shippingInfo"];
  className?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  // aeltere Spiegel-Eintraege haben nur den Text "A, B"
  const codes = shippingInfo?.trackingCodes?.length ? shippingInfo.trackingCodes : parseTrackingCodes(shippingInfo?.trackingNumber);
  if (codes.length === 0) return null;
  const links = new Map((shippingInfo?.trackingLinks ?? []).map((link) => [link.code, link.url]));
  return (
    <span className={cn("inline-flex flex-wrap gap-x-3 gap-y-1 font-mono text-sm", className)} data-testid={testId}>
      {codes.map((code) => {
        const url = links.get(code);
        return url ? (
          <a
            key={code}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
            title={t("shipping.trackingLinkTitle", { code })}
            onClick={(e) => e.stopPropagation()}
            data-testid="link-tracking"
          >
            {code}
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : (
          <span key={code}>{code}</span>
        );
      })}
    </span>
  );
}
