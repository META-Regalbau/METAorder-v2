import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { describeStrictReason, groupStrictReasons } from "@/lib/strictAutoCreateReasons";

export type StrictAutoCreateTrace = {
  allowed?: boolean;
  reasons?: string[];
  evaluatedAt?: string;
  shopwareError?: string;
};

/**
 * Warum die Automatik den Entwurf nicht selbst angelegt hat (extractedData.strictAutoCreateTrace).
 * Ohne Trace oder bei erlaubter Anlage ohne Fehler wird nichts angezeigt.
 */
export function StrictAutoCreateTraceAlert({ trace }: { trace: StrictAutoCreateTrace | null | undefined }) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  if (!trace || (trace.allowed && !trace.shopwareError)) return null;
  const reasons = groupStrictReasons(trace.reasons ?? []);
  return (
    <Alert className="border-muted bg-muted/30" data-testid="alert-strict-auto-create">
      <Bot className="h-4 w-4" />
      <AlertTitle className="text-sm">{t("strictAutoCreate.title")}</AlertTitle>
      <AlertDescription className="text-xs space-y-1">
        {reasons.length > 0 ? (
          <ul className="list-disc pl-4 space-y-0.5">
            {reasons.map((code) => (
              <li key={code} data-testid={`strict-reason-${code}`}>
                {describeStrictReason(code, t)}
              </li>
            ))}
          </ul>
        ) : null}
        {trace.shopwareError ? (
          <p>{t("strictAutoCreate.shopwareError", { error: trace.shopwareError })}</p>
        ) : null}
        {trace.evaluatedAt ? (
          <p className="text-muted-foreground">{t("strictAutoCreate.evaluatedAt", { date: fmt.dateTime(trace.evaluatedAt) })}</p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
