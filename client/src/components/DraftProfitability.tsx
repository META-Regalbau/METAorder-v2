import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Calculator, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseLocalePrice } from "@/lib/parseLocalePrice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import HerstellMarginIndicator, { herstellMarginDotClass } from "@/components/HerstellMarginIndicator";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useCanViewMarginDetails } from "@/hooks/useMarginVisibility";
import type {
  DraftProfitability,
  DraftProfitabilityBadge,
  DraftProfitabilityLine,
} from "@shared/draftProfitability";
import type { DraftMarginApprovalView } from "@shared/draftMarginApproval";

export type DraftProfitabilityResponse = {
  profitability: DraftProfitability | null;
  marginApproval?: DraftMarginApprovalView;
};

/** Listen und Entwurf neu laden, die DB nicht noch einmal rechnen lassen. */
function invalidateDraftListsAndDraft(kind: "order" | "offer") {
  queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === `/api/${kind}-drafts` && query.queryKey[2] !== "profitability",
  });
}

/**
 * DB der Bestell-/Angebotsentwürfe. Der Server rechnet und lässt ohne Recht „DB-Werte sehen“
 * alle Beträge weg (detailsHidden) — dann zeigt die Oberfläche nur die Ampel.
 * Der Aufschlag auf Herstellkosten steht groß, weil die Ampel daran hängt.
 */
export function useDraftProfitability(kind: "order" | "offer", draftId: string | undefined, enabled = true) {
  return useQuery<DraftProfitabilityResponse>({
    // Präfix "/api/<kind>-drafts": jede Entwurfs-Mutation (invalidateQueries) rechnet neu
    queryKey: [`/api/${kind}-drafts`, draftId, "profitability"],
    enabled: enabled && Boolean(draftId),
    retry: false,
  });
}

export function DraftProfitabilityCard({
  profitability,
  isLoading,
  isError,
  kind,
  draftId,
  marginApproval,
  readOnly,
}: {
  profitability: DraftProfitability | null | undefined;
  isLoading: boolean;
  isError: boolean;
  kind?: "order" | "offer";
  draftId?: string;
  marginApproval?: DraftMarginApprovalView;
  /** angelegter Entwurf: Freigabe nur anzeigen */
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const summary = profitability?.summary;
  const hidden = profitability?.detailsHidden === true;

  return (
    <Card data-testid="card-draft-profitability">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="w-4 h-4" />
          {t("draftProfitability.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {isLoading ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("draftProfitability.loading")}
          </p>
        ) : isError || !profitability || !summary ? (
          <p className="text-muted-foreground">{t("draftProfitability.error")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {summary.crmVerdict === "none" ? (
                <HerstellMarginIndicator marginPercent={null} verdict="none" />
              ) : (
                <span className="inline-flex items-center gap-2" data-testid={`draft-db-verdict-${summary.crmVerdict}`}>
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full shrink-0 ${herstellMarginDotClass(summary.crmVerdict)}`}
                    aria-hidden="true"
                  />
                  <span className="font-medium">{t(`marginTrafficLight.${summary.crmVerdict}`)}</span>
                </span>
              )}
              {!hidden && summary.marginPercent != null ? (
                <span className="text-right">
                  <span className="block text-xs text-muted-foreground">{t("draftProfitability.markup")}</span>
                  <span className="text-2xl font-semibold font-mono tabular-nums" data-testid="text-draft-db-markup">
                    {fmt.percentValue(summary.marginPercent)}
                  </span>
                </span>
              ) : null}
            </div>
            {!hidden && summary.db1Total != null ? (
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("draftProfitability.db1")}</dt>
                  <dd className="font-mono tabular-nums" data-testid="text-draft-db1">{fmt.currency(summary.db1Total)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("draftProfitability.herstellkosten")}</dt>
                  <dd className="font-mono tabular-nums">{fmt.currency(summary.herstellkostenTotal)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("draftProfitability.marginOnRevenue")}</dt>
                  <dd className="font-mono tabular-nums">{fmt.percentValue(summary.marginOnRevenuePercent)}</dd>
                </div>
              </dl>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {t("draftProfitability.coverage", {
                withData: summary.linesWithHerstellpreis,
                total: summary.productLineCount,
              })}
              {profitability.unpricedLineCount > 0
                ? ` · ${t("draftProfitability.unpriced", { count: profitability.unpricedLineCount })}`
                : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("draftProfitability.thresholds", {
                warn: fmt.number(profitability.thresholds.warnMarginPercent),
                min: fmt.number(profitability.thresholds.minMarginPercent),
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {profitability.frozen
                ? t("draftProfitability.frozen", { date: fmt.dateTime(profitability.computedAt) })
                : t("draftProfitability.computedAt", { date: fmt.dateTime(profitability.computedAt) })}
            </p>
            {hidden ? (
              <p className="text-xs text-muted-foreground">{t("draftProfitability.hiddenHint")}</p>
            ) : null}
            {kind && draftId && marginApproval && (marginApproval.required || marginApproval.latest?.status === "approved") ? (
              <DraftMarginApprovalPanel
                kind={kind}
                draftId={draftId}
                view={marginApproval}
                readOnly={readOnly}
              />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** DB-Zelle je Entwurfsposition. */
export function DraftLineMargin({ line }: { line: DraftProfitabilityLine | undefined }) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  if (!line) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-end gap-0.5" data-testid={`draft-line-db-${line.index}`}>
      <HerstellMarginIndicator
        marginPercent={line.marginPercent}
        marginOnRevenuePercent={line.marginOnRevenuePercent}
        verdict={line.crmVerdict}
        emphasis="markup"
      />
      {line.db1Abs != null ? (
        <span className="text-xs text-muted-foreground font-mono tabular-nums">
          {t("draftProfitability.db1Short")} {fmt.currency(line.db1Abs)}
        </span>
      ) : null}
      <span className="text-xs text-muted-foreground">{t(`draftProfitability.priceSource.${line.priceSource}`)}</span>
    </div>
  );
}

/**
 * Netto-Stückpreis einer Entwurfsposition ändern (leer bzw. Zurücksetzen = ermittelter Preis).
 * Der Server speichert, rechnet die DB neu und schickt sie mit; die Ampel springt sofort um.
 */
export function DraftLinePriceEditor({
  kind,
  draftId,
  index,
  line,
  manualUnitPriceNet,
  manualPriceChangedBy,
  disabled,
  onChanged,
}: {
  kind: "order" | "offer";
  draftId: string;
  index: number;
  line: DraftProfitabilityLine | undefined;
  manualUnitPriceNet?: number | null;
  manualPriceChangedBy?: string | null;
  disabled?: boolean;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const { toast } = useToast();
  // Die DB-Antwort ist nach dem Speichern schneller da als der neu geladene Entwurf
  const hasManual = typeof manualUnitPriceNet === "number" || line?.priceSource === "manual";
  const effective =
    line?.priceSource === "manual"
      ? line.unitPriceNet
      : typeof manualUnitPriceNet === "number"
        ? manualUnitPriceNet
        : (line?.unitPriceNet ?? null);

  const mutation = useMutation({
    mutationFn: async (unitPriceNet: number | null) => {
      const res = await apiRequest("PATCH", `/api/${kind}-drafts/${draftId}/line-price`, { index, unitPriceNet });
      return (await res.json()) as DraftProfitabilityResponse;
    },
    onSuccess: (data) => {
      queryClient.setQueryData([`/api/${kind}-drafts`, draftId, "profitability"], {
        profitability: data.profitability,
        marginApproval: data.marginApproval,
      });
      invalidateDraftListsAndDraft(kind);
      onChanged?.();
    },
    onError: (error: Error) =>
      toast({ title: t("draftProfitability.priceSaveError"), description: error.message, variant: "destructive" }),
  });

  const commit = (raw: string) => {
    if (raw.trim() === "") {
      if (hasManual) mutation.mutate(null);
      return;
    }
    const value = parseLocalePrice(raw);
    if (value == null || value < 0) {
      toast({ title: t("draftProfitability.priceInvalid"), variant: "destructive" });
      return;
    }
    const rounded = Math.round(value * 100) / 100;
    if (effective != null && Math.abs(rounded - effective) < 0.005) return;
    mutation.mutate(rounded);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <Input
          // neu aufbauen, wenn Server-Stand sich ändert (uncontrolled, speichert bei Verlassen/Enter)
          key={`${effective ?? "none"}-${hasManual}`}
          aria-label={t("draftProfitability.priceInputLabel", { position: index + 1 })}
          className="h-8 w-28 text-right font-mono tabular-nums"
          inputMode="decimal"
          defaultValue={effective != null ? fmt.decimal(effective, 2) : ""}
          placeholder={t("draftProfitability.priceNone")}
          disabled={disabled || mutation.isPending}
          data-testid={`input-line-price-${index}`}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
        />
        {hasManual && !disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={t("draftProfitability.priceReset")}
            aria-label={t("draftProfitability.priceReset")}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(null)}
            data-testid={`button-line-price-reset-${index}`}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
        ) : null}
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </div>
      {hasManual && manualPriceChangedBy ? (
        <span className="text-xs text-muted-foreground">
          {t("draftProfitability.priceChangedBy", { user: manualPriceChangedBy })}
        </span>
      ) : null}
      {effective != null && line && line.quantity > 1 ? (
        <span className="text-xs text-muted-foreground font-mono tabular-nums">
          {t("draftProfitability.lineTotal", { total: fmt.currency(effective * line.quantity) })}
        </span>
      ) : null}
    </div>
  );
}

/** Ampel in Entwurfslisten (Beträge nur, wenn der Server sie mitschickt), bei Rot mit Freigabe-Stand. */
export function DraftProfitabilityBadgeCell({ badge }: { badge: DraftProfitabilityBadge | null | undefined }) {
  const { t } = useTranslation();
  if (!badge) return <span className="text-sm text-muted-foreground">—</span>;
  const approval = badge.approvalState && badge.approvalState !== "not_required" ? badge.approvalState : null;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <HerstellMarginIndicator marginPercent={badge.marginPercent} verdict={badge.crmVerdict} emphasis="markup" />
      {approval ? (
        <span
          className={`text-xs whitespace-nowrap ${approval === "approved" ? "text-green-700 dark:text-green-400" : "text-destructive"}`}
          data-testid="text-draft-approval-state"
        >
          {t(`draftMarginApproval.listState.${approval}`)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Freigabe bei roter DB: Sachbearbeiter fordern mit Begründung an; wer das Recht
 * „DB-Werte sehen“ hat, gibt frei oder lehnt ab (oder gibt ohne Anforderung direkt frei).
 */
export function DraftMarginApprovalPanel({
  kind,
  draftId,
  view,
  readOnly,
}: {
  kind: "order" | "offer";
  draftId: string;
  view: DraftMarginApprovalView;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const { toast } = useToast();
  const canDecide = useCanViewMarginDetails();
  const [text, setText] = useState("");

  const mutation = useMutation({
    mutationFn: async (payload: { action: "request" | "decide"; body: Record<string, unknown> }) => {
      const res = await apiRequest("POST", `/api/${kind}-drafts/${draftId}/margin-approval/${payload.action}`, payload.body);
      return (await res.json()) as DraftProfitabilityResponse;
    },
    onSuccess: (data) => {
      queryClient.setQueryData([`/api/${kind}-drafts`, draftId, "profitability"], data);
      invalidateDraftListsAndDraft(kind);
      setText("");
    },
    onError: (error: Error) =>
      toast({ title: t("draftMarginApproval.saveError"), description: error.message, variant: "destructive" }),
  });

  const latest = view.latest;
  const approved = view.state === "approved" || (!view.required && latest?.status === "approved");
  const needsNew = view.state === "missing" || view.state === "stale" || view.state === "rejected";
  const textValid = text.trim().length >= 10;

  return (
    <div
      className={`mt-2 rounded-md border p-3 space-y-2 ${
        approved ? "border-green-600/40 bg-green-600/5" : "border-destructive/40 bg-destructive/5"
      }`}
      data-testid={`panel-margin-approval-${view.state}`}
    >
      <p className="text-sm font-medium">
        {approved ? t("draftMarginApproval.title.approved") : t(`draftMarginApproval.title.${view.state}`)}
      </p>
      {latest && (view.state !== "missing") ? (
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            {t("draftMarginApproval.requestedBy", {
              user: latest.requestedByName,
              date: fmt.dateTime(latest.requestedAt),
            })}
            {latest.marginPercent != null
              ? ` · ${t("draftMarginApproval.atMargin", { margin: fmt.percentValue(latest.marginPercent) })}`
              : ""}
          </p>
          <p className="italic">„{latest.reason}“</p>
          {latest.decidedByName ? (
            <p>
              {t(`draftMarginApproval.decidedBy.${latest.status}`, {
                user: latest.decidedByName,
                date: fmt.dateTime(latest.decidedAt),
              })}
              {latest.decisionComment ? `: „${latest.decisionComment}“` : ""}
            </p>
          ) : null}
        </div>
      ) : null}
      {view.state === "stale" ? (
        <p className="text-xs text-muted-foreground">{t("draftMarginApproval.staleHint")}</p>
      ) : null}

      {readOnly || approved ? null : view.state === "requested" ? (
        canDecide ? (
          <div className="space-y-2">
            <Label htmlFor={`margin-approval-comment-${draftId}`} className="text-xs">
              {t("draftMarginApproval.commentLabel")}
            </Label>
            <Textarea
              id={`margin-approval-comment-${draftId}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              data-testid="textarea-margin-approval-comment"
            />
            <div className="flex flex-wrap gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ action: "decide", body: { decision: "reject", comment: text } })}
                data-testid="button-margin-reject"
              >
                {t("draftMarginApproval.reject")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ action: "decide", body: { decision: "approve", comment: text } })}
                data-testid="button-margin-approve"
              >
                {t("draftMarginApproval.approve")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs">{t("draftMarginApproval.waiting")}</p>
        )
      ) : needsNew ? (
        <div className="space-y-2">
          <Label htmlFor={`margin-approval-reason-${draftId}`} className="text-xs">
            {t("draftMarginApproval.reasonLabel")}
          </Label>
          <Textarea
            id={`margin-approval-reason-${draftId}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder={t("draftMarginApproval.reasonPlaceholder")}
            data-testid="textarea-margin-approval-reason"
          />
          <div className="flex justify-end">
            {canDecide ? (
              <Button
                type="button"
                size="sm"
                disabled={!textValid || mutation.isPending}
                onClick={() => mutation.mutate({ action: "decide", body: { decision: "approve", comment: text } })}
                data-testid="button-margin-approve-direct"
              >
                {t("draftMarginApproval.approveDirect")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={!textValid || mutation.isPending}
                onClick={() => mutation.mutate({ action: "request", body: { reason: text } })}
                data-testid="button-margin-request"
              >
                {t("draftMarginApproval.request")}
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
