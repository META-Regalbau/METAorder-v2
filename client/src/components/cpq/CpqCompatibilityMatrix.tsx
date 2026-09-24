/**
 * CpqCompatibilityMatrix - Kompatibilitätsmatrix als Alternative zum Beziehungsgraph.
 *
 * Zeigt für jedes Paar von Komponententypen, das durch mindestens eine aktive
 * "compatibility"-Regel verknüpft ist, eine Produkt×Produkt-Matrix. Jede Zelle
 * wird mit derselben Auswertungslogik berechnet, die der Server für echte
 * Konfigurationen nutzt (shared/cpqRuleEvaluator.ts) – keine separate,
 * potenziell abweichende Anzeige-Heuristik.
 *
 * ✓ = alle zutreffenden Kompatibilitätsregeln für dieses Produktpaar erfüllt
 * ✗ = mindestens eine Regel verletzt (Tooltip nennt Regel + Attribut)
 * – = keine Regel für dieses Paar anwendbar (Attribut fehlt o. Ä.)
 */

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { evaluateCondition, type CpqCondition } from "@shared/cpqRuleEvaluator";

const ROLE_ICONS: Record<string, string> = {
  frame: "📐",
  beam: "🔩",
  shelf: "📦",
  accessory: "🔧",
  connector: "🔗",
};

type CpqSystem = { id: string; name: string; slug: string };
type CpqComponentType = { id: string; name: string; role: string };
type CpqProductMapping = {
  id: string;
  shopwareProductNumber: string;
  componentTypeId: string;
  status: string;
  productName?: string | null;
  productDetails?: {
    height?: number | null;
    depth?: number | null;
    loadCapacity?: number | null;
    price?: number | null;
  } | null;
};
type CpqRule = {
  id: string;
  name: string;
  type: string;
  status: string;
  message?: string | null;
  condition?: unknown;
};

type CpqCompatibilityMatrixProps = {
  system: CpqSystem;
  componentTypes: CpqComponentType[];
  mappings: CpqProductMapping[];
  rules: CpqRule[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null, nodeType?: "system" | "component" | "mapping" | null) => void;
  className?: string;
};

type Pair = { typeAId: string; typeBId: string; rules: Array<{ rule: CpqRule; condition: CpqCondition }> };

type CellResult = { status: "ok" | "violation" | "n/a"; failedRules: Array<{ name: string; message: string | null }> };

/** Baut aus productDetails den "component data"-Kontext, den evaluateCondition erwartet. */
function toComponentData(m: CpqProductMapping): Record<string, unknown> {
  return {
    height: m.productDetails?.height ?? undefined,
    depth: m.productDetails?.depth ?? undefined,
    load_capacity: m.productDetails?.loadCapacity ?? undefined,
    price: m.productDetails?.price ?? undefined,
  };
}

/** Findet alle Komponententyp-Paare, die durch mind. eine aktive Kompatibilitätsregel verbunden sind. */
function findPairs(componentTypes: CpqComponentType[], rules: CpqRule[]): Pair[] {
  const pairMap = new Map<string, Pair>();
  for (const rule of rules) {
    if (rule.type !== "compatibility" || rule.status !== "active") continue;
    const cond = rule.condition as CpqCondition | null;
    const sourceType = cond?.source?.component_type;
    const targetType = cond?.target?.component_type;
    if (!sourceType || !targetType) continue;
    const typeAId = componentTypes.find((ct) => ct.role === sourceType || ct.id === sourceType)?.id;
    const typeBId = componentTypes.find((ct) => ct.role === targetType || ct.id === targetType)?.id;
    if (!typeAId || !typeBId) continue;
    // fixed_value-Regeln (target.value gesetzt) vergleichen nur gegen sich selbst – trotzdem als
    // 1x1-„Paar" relevant, damit sie in der Matrix sichtbar sind.
    const key = typeAId <= typeBId ? `${typeAId}::${typeBId}` : `${typeBId}::${typeAId}`;
    if (!pairMap.has(key)) pairMap.set(key, { typeAId, typeBId, rules: [] });
    pairMap.get(key)!.rules.push({ rule, condition: cond! });
  }
  return [...pairMap.values()];
}

function evaluateCell(mA: CpqProductMapping, mB: CpqProductMapping, pairRules: Pair["rules"]): CellResult {
  const failed: Array<{ name: string; message: string | null }> = [];
  let anyApplicable = false;

  for (const { rule, condition } of pairRules) {
    // Regeln sind gerichtet (source.component_type → target.component_type), das Paar aber
    // ungeordnet aufgebaut (A/B beliebig zugeordnet) – daher beide Zuordnungen prüfen.
    anyApplicable = true;
    const config = {
      [`selected_${condition.source?.component_type}`]: toComponentData(mA),
      [`selected_${condition.target?.component_type}`]: toComponentData(mB),
    };
    const okAB = evaluateCondition(condition, config);
    // Falls die Regel andersherum gerichtet ist (B ist source, A ist target), zusätzlich in
    // umgekehrter Zuordnung prüfen – eine der beiden Zuordnungen muss zur Regel passen.
    const configBA = {
      [`selected_${condition.source?.component_type}`]: toComponentData(mB),
      [`selected_${condition.target?.component_type}`]: toComponentData(mA),
    };
    const okBA = evaluateCondition(condition, configBA);
    if (!okAB && !okBA) {
      failed.push({ name: rule.name, message: rule.message ?? null });
    }
  }

  if (!anyApplicable) return { status: "n/a", failedRules: [] };
  return failed.length > 0 ? { status: "violation", failedRules: failed } : { status: "ok", failedRules: [] };
}

export default function CpqCompatibilityMatrix({
  system,
  componentTypes,
  mappings,
  rules,
  selectedNodeId,
  onSelectNode,
  className = "",
}: CpqCompatibilityMatrixProps) {
  const pairs = useMemo(() => findPairs(componentTypes, rules), [componentTypes, rules]);
  const [activePairKey, setActivePairKey] = useState<string | null>(null);

  const activePair = useMemo(() => {
    if (pairs.length === 0) return null;
    const found = pairs.find((p) => `${p.typeAId}::${p.typeBId}` === activePairKey);
    return found ?? pairs[0];
  }, [pairs, activePairKey]);

  const componentTypeById = useMemo(() => {
    const m = new Map<string, CpqComponentType>();
    componentTypes.forEach((ct) => m.set(ct.id, ct));
    return m;
  }, [componentTypes]);

  if (pairs.length === 0) {
    return (
      <div className={`w-full h-full flex items-center justify-center ${className}`}>
        <div className="text-center max-w-md space-y-2 p-8">
          <Info className="h-8 w-8 mx-auto text-muted-foreground" />
          <h3 className="font-medium text-sm">Keine Kompatibilitätsregeln</h3>
          <p className="text-xs text-muted-foreground">
            Für {system.name} sind keine aktiven Regeln vom Typ „Kompatibilität" hinterlegt, die zwei
            Komponententypen verknüpfen. Legen Sie im Tab „Regeln" eine Kompatibilitätsregel an, um hier
            eine Matrix zu sehen.
          </p>
        </div>
      </div>
    );
  }

  const typeA = componentTypeById.get(activePair!.typeAId);
  const typeB = componentTypeById.get(activePair!.typeBId);
  const productsA = mappings.filter((m) => m.componentTypeId === activePair!.typeAId);
  const productsB = mappings.filter((m) => m.componentTypeId === activePair!.typeBId);

  return (
    <TooltipProvider delayDuration={150}>
      <div className={`w-full h-full flex flex-col bg-background ${className}`} data-testid="cpq-compatibility-matrix">
        {pairs.length > 1 && (
          <div className="p-3 border-b shrink-0 flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">Komponententyp-Paar</span>
            <Select
              value={`${activePair!.typeAId}::${activePair!.typeBId}`}
              onValueChange={(v) => setActivePairKey(v)}
            >
              <SelectTrigger className="h-8 text-xs max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pairs.map((p) => {
                  const key = `${p.typeAId}::${p.typeBId}`;
                  const a = componentTypeById.get(p.typeAId)?.name ?? "?";
                  const b = componentTypeById.get(p.typeBId)?.name ?? "?";
                  return (
                    <SelectItem key={key} value={key}>
                      {a} × {b} ({p.rules.length} {p.rules.length === 1 ? "Regel" : "Regeln"})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex-1 overflow-auto p-3">
          {productsA.length === 0 || productsB.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              {typeA?.name ?? "?"} oder {typeB?.name ?? "?"} hat noch keine zugeordneten Artikel.
            </div>
          ) : (
            <table className="border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-background p-2 border text-left align-bottom min-w-[180px]">
                    <span className="text-muted-foreground font-normal">
                      {ROLE_ICONS[typeA?.role ?? ""] ?? "•"} {typeA?.name}
                      {" \\ "}
                      {ROLE_ICONS[typeB?.role ?? ""] ?? "•"} {typeB?.name}
                    </span>
                  </th>
                  {productsB.map((mB) => (
                    <th
                      key={mB.id}
                      className={`p-2 border text-center align-bottom whitespace-nowrap font-medium cursor-pointer hover:bg-muted/50 ${selectedNodeId === mB.id ? "bg-muted" : ""}`}
                      onClick={() => onSelectNode(mB.id, "mapping")}
                      data-testid={`matrix-col-${mB.id}`}
                    >
                      <div className="[writing-mode:vertical-rl] rotate-180 h-24 flex items-center justify-center">
                        <code className="text-[10px]">{mB.shopwareProductNumber}</code>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {productsA.map((mA) => (
                  <tr key={mA.id}>
                    <th
                      className={`sticky left-0 bg-background p-2 border text-left font-medium whitespace-nowrap cursor-pointer hover:bg-muted/50 ${selectedNodeId === mA.id ? "bg-muted" : ""}`}
                      onClick={() => onSelectNode(mA.id, "mapping")}
                      data-testid={`matrix-row-${mA.id}`}
                    >
                      <code className="text-[10px]">{mA.shopwareProductNumber}</code>
                      {mA.productName && (
                        <span className="block text-muted-foreground font-normal truncate max-w-[160px]">
                          {mA.productName}
                        </span>
                      )}
                    </th>
                    {productsB.map((mB) => {
                      const cell = evaluateCell(mA, mB, activePair!.rules);
                      const cellContent =
                        cell.status === "ok" ? (
                          <span className="text-green-600 dark:text-green-400 font-semibold">✓</span>
                        ) : cell.status === "violation" ? (
                          <span className="text-destructive font-semibold">✗</span>
                        ) : (
                          <span className="text-muted-foreground/40">–</span>
                        );
                      return (
                        <td
                          key={mB.id}
                          className={`p-2 border text-center cursor-pointer hover:bg-muted/30 ${
                            cell.status === "violation" ? "bg-destructive/5" : cell.status === "ok" ? "bg-green-500/5" : ""
                          }`}
                          data-testid={`matrix-cell-${mA.id}-${mB.id}`}
                        >
                          {cell.status === "violation" ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button type="button" className="w-full h-full">
                                  {cellContent}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p className="font-medium mb-1">Nicht kompatibel</p>
                                {cell.failedRules.map((r, i) => (
                                  <p key={i} className="text-xs">
                                    {r.name}
                                    {r.message ? `: ${r.message}` : ""}
                                  </p>
                                ))}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            cellContent
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-3 py-2 border-t text-xs text-muted-foreground shrink-0 flex items-center gap-3 shrink-0">
          <Badge variant="secondary" className="bg-green-500/10 text-green-600 dark:text-green-400">✓ kompatibel</Badge>
          <Badge variant="secondary" className="bg-destructive/10 text-destructive">✗ Regel verletzt</Badge>
          <Badge variant="secondary" className="bg-muted text-muted-foreground/60">– keine Regel anwendbar</Badge>
        </div>
      </div>
    </TooltipProvider>
  );
}
