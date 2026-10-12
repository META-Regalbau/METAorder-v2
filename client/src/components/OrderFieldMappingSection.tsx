import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useIsAdministrator } from "@/hooks/useMarginVisibility";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Plus, X } from "lucide-react";
import {
  DEFAULT_ORDER_FIELD_MAPPING,
  DELIVERY_DATE_TARGET,
  ORDER_FIELD_SOURCES,
  ORDER_FIELD_SOURCE_SCOPE,
  BLOCKED_ORDER_FIELD_RE,
  type OrderFieldMappingSettings,
  type OrderFieldSource,
  type OrderFieldTarget,
} from "@shared/orderFieldMapping";

type CatalogField = { entity: string; name: string; type: string; label: string | null; setLabel: string | null; filledIn: number };
type Catalog = { fields: CatalogField[] };
type Preview = {
  order: Record<string, unknown>;
  lineItems: Record<string, Record<string, unknown>>;
  delivery: { shippingDateEarliest?: string; shippingDateLatest?: string };
  people: { ordererNote: string; salesRepNote: string } | null;
};

const QUERY_KEY = ["/api/settings/order-field-mapping"] as const;

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/**
 * Welche Entwurfsdaten in welche Zusatzfelder der Shopware-Bestellung gehen
 * (server/shopware/orderFieldValues.ts). Die Feldliste kommt aus dem Shop (nur für Admins lesbar);
 * ohne sie lässt sich der technische Feldname eintippen.
 */
export default function OrderFieldMappingSection() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const isAdmin = useIsAdministrator();
  const { data, isLoading } = useQuery<OrderFieldMappingSettings>({ queryKey: QUERY_KEY });
  const [draft, setDraft] = useState<OrderFieldMappingSettings | null>(null);
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const catalogQuery = useQuery<Catalog>({
    queryKey: ["/api/settings/shopware-custom-fields?sample=10"],
    enabled: isAdmin,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const fieldsByScope = useMemo(() => {
    const map = new Map<string, CatalogField[]>();
    for (const f of catalogQuery.data?.fields ?? []) {
      if (BLOCKED_ORDER_FIELD_RE.test(f.name)) continue;
      map.set(f.entity, [...(map.get(f.entity) ?? []), f]);
    }
    return map;
  }, [catalogQuery.data]);
  const labelOf = (field: string) => {
    if (field === DELIVERY_DATE_TARGET) return t("settings.orderFieldMapping.deliveryDateField");
    const f = catalogQuery.data?.fields.find((x) => x.name === field);
    return f?.label ?? null;
  };

  const save = useMutation({
    mutationFn: async (settings: OrderFieldMappingSettings) => (await apiRequest("PUT", "/api/settings/order-field-mapping", settings)).json(),
    onSuccess: (saved: OrderFieldMappingSettings) => {
      queryClient.setQueryData(QUERY_KEY, saved);
      setDraft(saved);
      toast({ title: t("settings.orderFieldMapping.saved") });
    },
    onError: (error: Error) => toast({ title: t("settings.orderFieldMapping.saveFailed"), description: error.message, variant: "destructive" }),
  });

  const [previewDraftId, setPreviewDraftId] = useState("");
  const preview = useMutation({
    mutationFn: async (draftId: string) =>
      (await apiRequest("GET", `/api/settings/order-field-mapping/preview?draftId=${encodeURIComponent(draftId)}`)).json() as Promise<Preview>,
    onError: (error: Error) => toast({ title: t("settings.orderFieldMapping.previewFailed"), description: error.message, variant: "destructive" }),
  });

  const setTargets = (source: OrderFieldSource, targets: OrderFieldTarget[]) =>
    setDraft((d) => (d ? { ...d, targets: { ...d.targets, [source]: targets } } : d));

  if (isLoading || !draft) {
    return (
      <Card className="p-6">
        <Loader2 className="h-4 w-4 animate-spin" />
      </Card>
    );
  }

  return (
    <Card className="p-6" data-testid="card-order-field-mapping">
      <div className="flex items-start justify-between gap-4 mb-2">
        <h2 className="text-sm font-medium uppercase tracking-wide">{t("settings.orderFieldMapping.title")}</h2>
        <div className="flex items-center gap-2">
          <Label htmlFor="order-field-mapping-enabled" className="text-sm">
            {t("settings.orderFieldMapping.enabled")}
          </Label>
          <Switch
            id="order-field-mapping-enabled"
            checked={draft.enabled}
            onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
            data-testid="switch-order-field-mapping"
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{t("settings.orderFieldMapping.description")}</p>
      {!isAdmin && <p className="text-xs text-muted-foreground mb-4">{t("settings.orderFieldMapping.catalogAdminOnly")}</p>}
      {catalogQuery.isError && <p className="text-xs text-destructive mb-4">{t("settings.orderFieldMapping.catalogFailed")}</p>}

      <div className="divide-y">
        {ORDER_FIELD_SOURCES.map((source) => (
          <SourceRow
            key={source}
            source={source}
            targets={draft.targets[source]}
            options={
              source === "deliveryDate"
                ? [{ entity: "order_delivery", name: DELIVERY_DATE_TARGET, type: "datetime", label: t("settings.orderFieldMapping.deliveryDateField"), setLabel: null, filledIn: 0 }]
                : fieldsByScope.get(ORDER_FIELD_SOURCE_SCOPE[source]) ?? []
            }
            allowManual={source !== "deliveryDate"}
            labelOf={labelOf}
            onChange={(targets) => setTargets(source, targets)}
            disabled={!draft.enabled}
          />
        ))}
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" onClick={() => setDraft(DEFAULT_ORDER_FIELD_MAPPING)} data-testid="button-order-field-mapping-reset">
          {t("settings.orderFieldMapping.reset")}
        </Button>
        <Button onClick={() => save.mutate(draft)} disabled={save.isPending} data-testid="button-order-field-mapping-save">
          {save.isPending ? t("settings.orderFieldMapping.saving") : t("settings.orderFieldMapping.save")}
        </Button>
      </div>

      <div className="mt-6 border-t pt-4 space-y-2">
        <Label className="text-sm font-medium">{t("settings.orderFieldMapping.previewTitle")}</Label>
        <p className="text-xs text-muted-foreground">{t("settings.orderFieldMapping.previewHint")}</p>
        <div className="flex gap-2">
          <Input
            value={previewDraftId}
            onChange={(e) => setPreviewDraftId(e.target.value.trim())}
            placeholder={t("settings.orderFieldMapping.previewPlaceholder")}
            aria-label={t("settings.orderFieldMapping.previewPlaceholder")}
            data-testid="input-order-field-preview-draft"
          />
          <Button
            variant="outline"
            onClick={() => preview.mutate(previewDraftId)}
            disabled={!previewDraftId || preview.isPending}
            data-testid="button-order-field-preview"
          >
            {preview.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("settings.orderFieldMapping.previewRun")}
          </Button>
        </div>
        {preview.data && <PreviewResult preview={preview.data} labelOf={labelOf} />}
      </div>
    </Card>
  );
}

function SourceRow(props: {
  source: OrderFieldSource;
  targets: OrderFieldTarget[];
  options: CatalogField[];
  allowManual: boolean;
  labelOf: (field: string) => string | null;
  onChange: (targets: OrderFieldTarget[]) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [manual, setManual] = useState("");
  const free = props.options.filter((o) => !props.targets.some((tg) => tg.field === o.name));
  const add = (target: OrderFieldTarget) => {
    if (props.targets.some((tg) => tg.field === target.field) || props.targets.length >= 5) return;
    props.onChange([...props.targets, target]);
  };
  const manualOk = /^[A-Za-z][\w-]{1,80}$/.test(manual) && !BLOCKED_ORDER_FIELD_RE.test(manual);
  return (
    <div className="py-3 grid gap-2 md:grid-cols-[minmax(0,14rem)_1fr]" data-testid={`row-order-field-${props.source}`}>
      <div>
        <div className="text-sm font-medium">{t(`settings.orderFieldMapping.sources.${props.source}.label`)}</div>
        <div className="text-xs text-muted-foreground">{t(`settings.orderFieldMapping.sources.${props.source}.hint`)}</div>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {props.targets.length === 0 && <span className="text-xs text-muted-foreground">{t("settings.orderFieldMapping.notTransferred")}</span>}
          {props.targets.map((tg) => (
            <Badge key={tg.field} variant="secondary" className="gap-1 font-normal">
              {props.labelOf(tg.field) ?? tg.field}
              {tg.field !== DELIVERY_DATE_TARGET && <span className="text-muted-foreground font-mono text-[10px]">{tg.field}</span>}
              <button
                type="button"
                className="ml-1 rounded hover:bg-muted"
                onClick={() => props.onChange(props.targets.filter((x) => x.field !== tg.field))}
                disabled={props.disabled}
                aria-label={t("settings.orderFieldMapping.remove")}
                data-testid={`button-remove-${props.source}-${tg.field}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {free.length > 0 && (
            <Select
              value=""
              onValueChange={(name) => {
                const f = props.options.find((o) => o.name === name);
                if (f) add({ field: f.name, type: f.type });
              }}
              disabled={props.disabled}
            >
              <SelectTrigger
                className="h-8 w-64 text-xs"
                aria-label={`${t(`settings.orderFieldMapping.sources.${props.source}.label`)}: ${t("settings.orderFieldMapping.addField")}`}
                data-testid={`select-add-${props.source}`}
              >
                <SelectValue placeholder={t("settings.orderFieldMapping.addField")} />
              </SelectTrigger>
              <SelectContent>
                {free.map((f) => (
                  <SelectItem key={f.name} value={f.name} className="text-xs">
                    {(f.label ?? f.name) + (f.setLabel ? ` · ${f.setLabel}` : "")}
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">{f.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {props.allowManual && (
            <div className="flex gap-1">
              <Input
                className="h-8 w-48 text-xs font-mono"
                value={manual}
                onChange={(e) => setManual(e.target.value.trim())}
                placeholder={t("settings.orderFieldMapping.manualPlaceholder")}
                aria-label={`${t(`settings.orderFieldMapping.sources.${props.source}.label`)}: ${t("settings.orderFieldMapping.manualPlaceholder")}`}
                disabled={props.disabled}
                data-testid={`input-manual-${props.source}`}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={props.disabled || !manualOk}
                onClick={() => {
                  add({ field: manual, type: "text" });
                  setManual("");
                }}
                aria-label={t("settings.orderFieldMapping.addField")}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewResult({ preview, labelOf }: { preview: Preview; labelOf: (field: string) => string | null }) {
  const { t } = useTranslation();
  const orderEntries = Object.entries(preview.order);
  const lineEntries = Object.entries(preview.lineItems);
  return (
    <div className="rounded border p-3 text-xs space-y-2" data-testid="order-field-preview">
      {orderEntries.length === 0 && !preview.delivery.shippingDateEarliest && lineEntries.length === 0 && (
        <div className="text-muted-foreground">{t("settings.orderFieldMapping.previewEmpty")}</div>
      )}
      {orderEntries.map(([field, value]) => (
        <div key={field} className="grid grid-cols-[minmax(0,14rem)_1fr] gap-2">
          <span className="text-muted-foreground">{labelOf(field) ?? field}</span>
          <span className="break-all">{show(value)}</span>
        </div>
      ))}
      {preview.delivery.shippingDateEarliest && (
        <div className="grid grid-cols-[minmax(0,14rem)_1fr] gap-2">
          <span className="text-muted-foreground">{labelOf(DELIVERY_DATE_TARGET)}</span>
          <span>
            {preview.delivery.shippingDateEarliest.slice(0, 10)}
            {preview.delivery.shippingDateLatest && preview.delivery.shippingDateLatest !== preview.delivery.shippingDateEarliest
              ? ` – ${preview.delivery.shippingDateLatest.slice(0, 10)}`
              : ""}
          </span>
        </div>
      )}
      {lineEntries.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1">{t("settings.orderFieldMapping.previewLines", { count: lineEntries.length })}</div>
          {lineEntries.slice(0, 10).map(([productId, fields]) => (
            <div key={productId} className="break-all">
              {Object.values(fields).map(show).join(" · ")}
            </div>
          ))}
        </div>
      )}
      {preview.people && (
        <div className="text-muted-foreground">
          {t("settings.orderFieldMapping.previewPeople", {
            orderer: t(`settings.orderFieldMapping.people.orderer.${preview.people.ordererNote}`),
            salesRep: t(`settings.orderFieldMapping.people.salesRep.${preview.people.salesRepNote}`),
          })}
        </div>
      )}
    </div>
  );
}
