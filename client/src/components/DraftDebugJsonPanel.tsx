import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Braces, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export type DraftDebugMeta = {
  id: string;
  kind: "order" | "offer";
  originalFileName: string;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  originalFilePath?: string | null;
  shopwareCustomerId?: string | null;
  shopwareOrderId?: string | null;
  shopwareOfferId?: string | null;
};

type DebugTab = "extraction" | "matching" | "full";

type DraftDebugJsonPanelProps = {
  meta: DraftDebugMeta;
  extractedData: unknown;
  matchingResults: unknown;
  /** Z. B. Cross-Selling-Vorschläge nur bei Bedarf */
  extraSections?: Record<string, unknown>;
};

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

export function DraftDebugJsonPanel({
  meta,
  extractedData,
  matchingResults,
  extraSections,
}: DraftDebugJsonPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DebugTab>("extraction");

  const fullPayload = useMemo(
    () => ({
      meta,
      extractedData,
      matchingResults,
      ...(extraSections && Object.keys(extraSections).length > 0 ? { extra: extraSections } : {}),
    }),
    [meta, extractedData, matchingResults, extraSections]
  );

  const activeJson = useMemo(() => {
    if (tab === "extraction") return safeStringify(extractedData);
    if (tab === "matching") return safeStringify(matchingResults);
    return safeStringify(fullPayload);
  }, [tab, extractedData, matchingResults, fullPayload]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(activeJson);
      toast({
        title: t("orderDrafts.review.jsonCopied", "JSON kopiert"),
        description: t(
          "orderDrafts.review.jsonCopiedDescription",
          "Die erkannten Elemente wurden in die Zwischenablage kopiert."
        ),
      });
    } catch {
      toast({
        title: t("common.error", "Fehler"),
        description: t("orderDrafts.review.jsonCopyError", "Konnte JSON nicht kopieren."),
        variant: "destructive",
      });
    }
  };

  return (
    <Card data-testid="card-draft-debug-json" className="border-dashed border-muted-foreground/40">
      <CardHeader className="py-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium text-muted-foreground">
          <button
            type="button"
            className="flex items-center gap-2 text-left hover:text-foreground transition-colors"
            onClick={() => setOpen((v) => !v)}
            data-testid="button-toggle-draft-debug"
          >
            <Braces className="w-4 h-4 shrink-0" />
            {t("drafts.debug.title", "Debug: JSON")}
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {open && (
            <Button type="button" size="sm" variant="outline" onClick={copy} data-testid="button-copy-draft-debug-json">
              <Copy className="w-4 h-4 mr-1" />
              {t("orderDrafts.review.copyJson", "JSON kopieren")}
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3 pt-0">
          <p className="text-xs text-muted-foreground">
            {t(
              "drafts.debug.hint",
              "Rohdaten aus dem Server — Extraktion (KI), Produkt-Matching und Metadaten. Hilft beim Abgleich mit CLI-Tests."
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["extraction", t("drafts.debug.tabExtraction", "Extraktion")],
                ["matching", t("drafts.debug.tabMatching", "Matching")],
                ["full", t("drafts.debug.tabFull", "Alles")],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={tab === key ? "default" : "outline"}
                onClick={() => setTab(key)}
                data-testid={`button-draft-debug-tab-${key}`}
              >
                {label}
              </Button>
            ))}
          </div>
          <pre
            className="max-h-[min(420px,50vh)] overflow-auto rounded-md border bg-muted/40 p-3 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words"
            data-testid="pre-draft-debug-json"
          >
            {activeJson}
          </pre>
        </CardContent>
      )}
    </Card>
  );
}
