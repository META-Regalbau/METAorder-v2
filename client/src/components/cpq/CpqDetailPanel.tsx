/**
 * Detail-Panel – Original-Stil: Stammdaten, CPQ-Geometrie, Aktive Regeln
 * 420px breit, Header mit Icon/Titel/SKU/Status-Badge
 * Stammdaten aus Shopware (Product-Cache), CPQ-Geometrie aus DB
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Pencil, Plus, Search, Save } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import type { LocaleFormatters } from "@/lib/localeFormat";

const ROLE_ICONS: Record<string, string> = {
  frame: "📐",
  beam: "🔩",
  shelf: "📦",
  accessory: "🔧",
  connector: "🔗",
};

type CpqComponentType = { id: string; name: string; role: string };
type CpqProductMapping = {
  id: string;
  shopwareProductNumber: string;
  componentTypeId: string;
  productName?: string | null;
  productDetails?: {
    height?: number | null;
    depth?: number | null;
    loadCapacity?: number | null;
    price?: number | null;
    manufacturerNumber?: string | null;
  } | null;
};
type CpqRule = { id: string; name: string; type: string; message?: string | null };

type CpqGeometry = {
  id: string;
  productMappingId: string;
  origin?: { x: number; y: number; z: number } | null;
  anchorPoints?: Array<{ id?: string; position: { x: number; y: number; z: number }; type?: string; pattern?: string; start?: number; pitch?: number }> | null;
  boundingBox?: { width: number; height: number; depth: number } | null;
  glbAssetUrl?: string | null;
  lodLevels?: Record<string, string> | null;
};

type CpqDetailPanelProps = {
  selectedNodeId: string | null;
  selectedNodeType: "system" | "component" | "mapping" | null;
  systemName: string;
  componentTypes: CpqComponentType[];
  mappings: CpqProductMapping[];
  rules: CpqRule[];
  onClose: () => void;
  onEditRule?: (ruleId: string) => void;
  onAddRule?: () => void;
};

const RULE_TYPE_BADGE: Record<string, { labelKey: string; className: string }> = {
  compatibility: { labelKey: "cpq.detail.ruleType.compatibility", className: "bg-green-500/10 text-green-600 dark:text-green-400" },
  physical: { labelKey: "cpq.detail.ruleType.physical", className: "bg-primary/10 text-primary" },
  configuration: { labelKey: "cpq.detail.ruleType.configuration", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  business: { labelKey: "cpq.detail.ruleType.business", className: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
};

function CpqGeometryEdit({
  productMappingId,
  productNumber,
  manufacturerNumber,
  geometry,
  geometryLoading,
}: {
  productMappingId: string;
  productNumber: string;
  manufacturerNumber?: string | null;
  geometry: CpqGeometry | null;
  geometryLoading: boolean;
}) {
  const { t } = useTranslation();
  const [glbUrl, setGlbUrl] = useState(geometry?.glbAssetUrl ?? "");
  useEffect(() => {
    setGlbUrl(geometry?.glbAssetUrl ?? "");
  }, [geometry?.glbAssetUrl]);

  const upsertGeometryMutation = useMutation({
    mutationFn: async (payload: { glbAssetUrl?: string | null }) => {
      const res = await apiRequest("PUT", `/api/cpq/product-mappings/${productMappingId}/geometry`, payload);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cpq/product-mappings", productMappingId, "geometry"] });
    },
  });

  const resolveGlbMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({ productNumber });
      if (manufacturerNumber) params.set("manufacturerNumber", manufacturerNumber);
      const res = await apiRequest("GET", `/api/cpq/glb-resolve?${params.toString()}`);
      return res.json() as Promise<{ filename?: string | null; url?: string | null }>;
    },
    onSuccess: (data) => {
      if (data?.url) setGlbUrl(data.url);
    },
  });

  return (
    <div className="p-4 border-b">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        {t("cpq.detail.geometryTitle")}
      </div>
      {geometryLoading ? (
        <div className="text-sm text-muted-foreground">{t("cpq.detail.loading")}</div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-[10.5px] text-muted-foreground block mb-1">{t("cpq.detail.glbUrl")}</label>
            <div className="flex gap-1">
              <Input
                value={glbUrl}
                onChange={(e) => setGlbUrl(e.target.value)}
                placeholder="/cpq-models/..."
                className="text-sm font-mono h-8"
              />
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                title={t("cpq.detail.searchGlb")}
                onClick={() => resolveGlbMutation.mutate()}
                disabled={resolveGlbMutation.isPending}
              >
                <Search className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <Button
            size="sm"
            variant="default"
            className="w-full"
            onClick={() => upsertGeometryMutation.mutate({ glbAssetUrl: glbUrl || null })}
            disabled={upsertGeometryMutation.isPending}
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {t("cpq.detail.saveGeometry")}
          </Button>
          {geometry && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded bg-muted/50">
                <div className="text-muted-foreground">{t("cpq.detail.holePattern")}</div>
                <div className="font-mono">{geometry.anchorPoints?.[0]?.start ?? "—"} / {geometry.anchorPoints?.[0]?.pitch ?? "—"} mm</div>
              </div>
              <div className="p-2 rounded bg-muted/50">
                <div className="text-muted-foreground">{t("cpq.detail.anchorPoints")}</div>
                <div className="font-mono">{Array.isArray(geometry.anchorPoints) ? geometry.anchorPoints.length : 0}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDim(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value} mm`;
}
function formatPrice(value: number | null | undefined, fmt: LocaleFormatters): string {
  if (value == null) return "—";
  return fmt.currency(value);
}

export default function CpqDetailPanel({
  selectedNodeId,
  selectedNodeType,
  systemName,
  componentTypes,
  mappings,
  rules,
  onClose,
  onEditRule,
  onAddRule,
}: CpqDetailPanelProps) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const selectedMapping = selectedNodeId && selectedNodeType === "mapping" ? mappings.find((x) => x.id === selectedNodeId) : null;
  const { data: geometry, isLoading: geometryLoading } = useQuery<CpqGeometry | null>({
    queryKey: ["/api/cpq/product-mappings", selectedNodeId, "geometry"],
    queryFn: async () => {
      const res = await fetch(`/api/cpq/product-mappings/${selectedNodeId}/geometry`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch geometry");
      return res.json();
    },
    enabled: !!selectedNodeId && selectedNodeType === "mapping",
  });

  let title = "";
  let sku = "";
  let iconKey = "accessory";
  let subLabel = "";

  if (selectedNodeId && selectedNodeType === "system") {
    title = systemName;
    subLabel = `${componentTypes.length} Typen · ${mappings.length} Artikel`;
    iconKey = "frame";
  } else if (selectedNodeId && selectedNodeType === "component") {
    const ct = componentTypes.find((c) => c.id === selectedNodeId);
    if (ct) {
      title = ct.name;
      subLabel = `${mappings.filter((m) => m.componentTypeId === ct.id).length} Artikel`;
      iconKey = ct.role;
    }
  } else if (selectedNodeId && selectedNodeType === "mapping") {
    const m = mappings.find((x) => x.id === selectedNodeId);
    if (m) {
      title = m.productName ? `${m.shopwareProductNumber} – ${m.productName}` : m.shopwareProductNumber;
      sku = m.shopwareProductNumber;
      const ct = componentTypes.find((c) => c.id === m.componentTypeId);
      iconKey = ct?.role ?? "accessory";
    }
  }

  if (!selectedNodeId) {
    return (
      <div className="w-[420px] bg-muted/30 border-l flex flex-col shrink-0 items-center justify-center p-8 text-center text-muted-foreground">
        <p className="text-sm">{t("cpq.detail.emptyHint")}</p>
      </div>
    );
  }

  const icon = ROLE_ICONS[iconKey] ?? "📦";

  return (
    <div className="w-[420px] bg-muted/30 border-l flex flex-col shrink-0">
      {/* Header */}
      <div className="p-5 border-b flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 bg-primary/10">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-base">{title || "—"}</div>
          {sku && <div className="text-xs text-muted-foreground font-mono mt-0.5">{sku}</div>}
          <Badge variant="secondary" className="mt-1.5 text-[11px] font-semibold">
            {t("cpq.detail.allRulesMet")}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={onClose} title={t("cpq.detail.close")}>
          ✕
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {/* Stammdaten (Shopware) – aus Product-Cache */}
        {(selectedNodeType === "mapping" || selectedNodeType === "component") && (
          <div className="p-4 border-b">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              {t("cpq.detail.masterData")}
            </div>
            {selectedNodeType === "mapping" && selectedMapping && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="p-2.5 rounded-lg bg-muted/50 col-span-2">
                  <div className="text-[10.5px] text-muted-foreground mb-0.5">{t("cpq.detail.productNumber")}</div>
                  <div className="text-sm font-mono">{selectedMapping.shopwareProductNumber || "—"}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-muted/50 col-span-2">
                  <div className="text-[10.5px] text-muted-foreground mb-0.5">{t("cpq.detail.manufacturerNumber")}</div>
                  <div className="text-sm font-mono">{selectedMapping.productDetails?.manufacturerNumber || "—"}</div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-lg bg-muted/50">
                <div className="text-[10.5px] text-muted-foreground mb-0.5">{t("cpq.detail.height")}</div>
                <div className="text-sm font-semibold font-mono">
                  {selectedNodeType === "mapping" && selectedMapping?.productDetails ? formatDim(selectedMapping.productDetails.height) : "—"}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/50">
                <div className="text-[10.5px] text-muted-foreground mb-0.5">{t("cpq.detail.depth")}</div>
                <div className="text-sm font-semibold font-mono">
                  {selectedNodeType === "mapping" && selectedMapping?.productDetails ? formatDim(selectedMapping.productDetails.depth) : "—"}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/50">
                <div className="text-[10.5px] text-muted-foreground mb-0.5">{t("cpq.detail.loadCapacity")}</div>
                <div className="text-sm font-semibold font-mono">
                  {selectedNodeType === "mapping" && selectedMapping?.productDetails?.loadCapacity != null
                    ? `${selectedMapping.productDetails.loadCapacity} kg`
                    : "—"}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/50">
                <div className="text-[10.5px] text-muted-foreground mb-0.5">{t("cpq.detail.listPrice")}</div>
                <div className="text-sm font-semibold font-mono">
                  {selectedNodeType === "mapping" && selectedMapping?.productDetails ? formatPrice(selectedMapping.productDetails.price, fmt) : "—"}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CPQ-Geometrie – aus DB (product-mapping geometry) mit Bearbeitung */}
        {selectedNodeType === "mapping" && selectedMapping && (
          <CpqGeometryEdit
            productMappingId={selectedNodeId!}
            productNumber={selectedMapping.shopwareProductNumber}
            manufacturerNumber={selectedMapping.productDetails?.manufacturerNumber}
            geometry={geometry ?? null}
            geometryLoading={geometryLoading}
          />
        )}

        {/* Aktive Regeln */}
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {t("cpq.detail.activeRules", { count: rules.length })}
          </div>
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("cpq.detail.noRules")}</p>
          ) : (
            <div className="space-y-2.5">
              {rules.slice(0, 6).map((r) => {
                const badge = RULE_TYPE_BADGE[r.type] ?? { labelKey: "", className: "bg-muted text-muted-foreground" };
                return (
                  <div
                    key={r.id}
                    className="p-3.5 rounded-lg border bg-card hover:border-muted-foreground/50 transition-colors cursor-pointer group"
                    onClick={() => onEditRule?.(r.id)}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className={`text-[10px] font-semibold ${badge.className}`}>
                        {badge.labelKey ? t(badge.labelKey) : r.type}
                      </Badge>
                      <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-6 w-6" title={t("cpq.detail.edit")}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm leading-relaxed mb-1">{r.name}</p>
                    {r.message && <p className="text-xs text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded">{r.message}</p>}
                  </div>
                );
              })}
            </div>
          )}
          {onAddRule && (
            <button
              type="button"
              onClick={onAddRule}
              className="w-full mt-2 py-2.5 border-2 border-dashed rounded-lg text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="h-4 w-4" />
              {t("cpq.detail.addRule")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
