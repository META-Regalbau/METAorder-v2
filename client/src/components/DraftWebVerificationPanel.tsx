import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe, CheckCircle2, XCircle } from "lucide-react";
import type { CommercialDraftAiExtractedMeta } from "@shared/schema";

type WebV = NonNullable<CommercialDraftAiExtractedMeta["webDomainVerification"]>;

function Row({ label, hit }: { label: string; hit: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {hit ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-label="ok" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="no" />
      )}
    </div>
  );
}

export function DraftWebVerificationPanel({
  data,
  i18nPrefix,
}: {
  data: WebV;
  i18nPrefix: "offerDrafts.review" | "orderDrafts.review";
}) {
  const { t } = useTranslation();
  const p = (key: string) => t(`${i18nPrefix}.${key}`);

  return (
    <Card className="border-muted">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-4 w-4" />
          {p("webVerificationTitle")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{p("webVerificationHint")}</p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {data.skippedReason === "freemail" && (
          <p className="text-muted-foreground">{p("webVerificationSkippedFreemail")}</p>
        )}
        {data.skippedReason === "no_email_context" && (
          <p className="text-muted-foreground">{p("webVerificationSkippedNoEmail")}</p>
        )}
        {!data.skippedReason && (
          <>
            {data.domain ? (
              <div>
                <span className="text-xs text-muted-foreground">{p("webVerificationDomain")}</span>
                <p className="font-mono text-sm">{data.domain}</p>
              </div>
            ) : null}
            {data.urlsTried?.length ? (
              <div>
                <span className="text-xs text-muted-foreground">{p("webVerificationUrls")}</span>
                <ul className="mt-1 list-inside list-disc font-mono text-xs break-all">
                  {data.urlsTried.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="grid gap-1 rounded-md border bg-muted/30 p-3">
              <Row label={p("webVerificationZip")} hit={data.checks.zipMatch} />
              <Row label={p("webVerificationCity")} hit={data.checks.cityMatch} />
              <Row label={p("webVerificationCompany")} hit={data.checks.companyMatch} />
              <Row label={p("webVerificationStreet")} hit={data.checks.streetPartialMatch} />
            </div>
            {data.error && !data.ok ? (
              <p className="text-xs text-amber-700 dark:text-amber-500">{data.error}</p>
            ) : null}
            {data.excerpt && data.excerpt.length > 20 ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">{p("webVerificationExcerpt")}</summary>
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 font-sans">
                  {data.excerpt}
                </pre>
              </details>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
