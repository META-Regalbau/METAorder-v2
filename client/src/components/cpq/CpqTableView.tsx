/**
 * CpqTableView - Tabellenansicht als Alternative zum Beziehungsgraph.
 * Zeigt alle Produkt-Mappings des Systems flach als sortierbare Tabelle
 * (Komponententyp, Artikelnummer, Produktname, Maße, Tragfähigkeit, Preis, Status).
 * Klick auf eine Zeile selektiert das Mapping – gleiches Verhalten wie im Graph,
 * damit das Detail-Panel rechts konsistent funktioniert.
 */

import { useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

type CpqTableViewProps = {
  system: CpqSystem;
  componentTypes: CpqComponentType[];
  mappings: CpqProductMapping[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null, nodeType?: "system" | "component" | "mapping" | null) => void;
  className?: string;
};

type SortKey = "componentType" | "sku" | "name" | "height" | "depth" | "loadCapacity" | "price" | "status";
type SortDir = "asc" | "desc";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active: { label: "Aktiv", className: "bg-green-500/10 text-green-600 dark:text-green-400" },
  draft: { label: "Entwurf", className: "bg-muted text-muted-foreground" },
  inactive: { label: "Inaktiv", className: "bg-destructive/10 text-destructive" },
};

function formatNum(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined) return "–";
  return `${v.toLocaleString("de-DE")} ${unit}`;
}

export default function CpqTableView({
  system,
  componentTypes,
  mappings,
  selectedNodeId,
  onSelectNode,
  className = "",
}: CpqTableViewProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("componentType");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const componentTypeById = useMemo(() => {
    const m = new Map<string, CpqComponentType>();
    componentTypes.forEach((ct) => m.set(ct.id, ct));
    return m;
  }, [componentTypes]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    let filtered = mappings.filter((m) => {
      if (!term) return true;
      const ct = componentTypeById.get(m.componentTypeId);
      return (
        m.shopwareProductNumber.toLowerCase().includes(term) ||
        (m.productName ?? "").toLowerCase().includes(term) ||
        (ct?.name ?? "").toLowerCase().includes(term)
      );
    });

    const dir = sortDir === "asc" ? 1 : -1;
    filtered = [...filtered].sort((a, b) => {
      const ctA = componentTypeById.get(a.componentTypeId)?.name ?? "";
      const ctB = componentTypeById.get(b.componentTypeId)?.name ?? "";
      switch (sortKey) {
        case "componentType":
          return dir * ctA.localeCompare(ctB);
        case "sku":
          return dir * a.shopwareProductNumber.localeCompare(b.shopwareProductNumber);
        case "name":
          return dir * (a.productName ?? "").localeCompare(b.productName ?? "");
        case "height":
          return dir * ((a.productDetails?.height ?? -Infinity) - (b.productDetails?.height ?? -Infinity));
        case "depth":
          return dir * ((a.productDetails?.depth ?? -Infinity) - (b.productDetails?.depth ?? -Infinity));
        case "loadCapacity":
          return dir * ((a.productDetails?.loadCapacity ?? -Infinity) - (b.productDetails?.loadCapacity ?? -Infinity));
        case "price":
          return dir * ((a.productDetails?.price ?? -Infinity) - (b.productDetails?.price ?? -Infinity));
        case "status":
          return dir * a.status.localeCompare(b.status);
        default:
          return 0;
      }
    });

    return filtered;
  }, [mappings, componentTypeById, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortHead = ({ label, sortKeyValue }: { label: string; sortKeyValue: SortKey }) => (
    <TableHead
      className="cursor-pointer select-none whitespace-nowrap"
      onClick={() => toggleSort(sortKeyValue)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`h-3 w-3 ${sortKey === sortKeyValue ? "opacity-100" : "opacity-30"}`} />
      </span>
    </TableHead>
  );

  return (
    <div className={`w-full h-full flex flex-col bg-background ${className}`} data-testid="cpq-table-view">
      <div className="p-3 border-b shrink-0">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Suchen in ${system.name} – Artikelnummer, Name, Komponententyp …`}
          className="max-w-sm h-8 text-sm"
          data-testid="input-table-view-search"
        />
      </div>
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            {mappings.length === 0
              ? "Keine Produkt-Mappings in diesem System."
              : "Keine Treffer für die Suche."}
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <SortHead label="Komponententyp" sortKeyValue="componentType" />
                <SortHead label="Artikelnummer" sortKeyValue="sku" />
                <SortHead label="Produktname" sortKeyValue="name" />
                <SortHead label="Höhe" sortKeyValue="height" />
                <SortHead label="Tiefe" sortKeyValue="depth" />
                <SortHead label="Tragfähigkeit" sortKeyValue="loadCapacity" />
                <SortHead label="Preis" sortKeyValue="price" />
                <SortHead label="Status" sortKeyValue="status" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => {
                const ct = componentTypeById.get(m.componentTypeId);
                const statusBadge = STATUS_BADGE[m.status] ?? { label: m.status, className: "bg-muted text-muted-foreground" };
                const isSelected = selectedNodeId === m.id;
                return (
                  <TableRow
                    key={m.id}
                    className={`cursor-pointer ${isSelected ? "bg-muted/70" : ""}`}
                    onClick={() => onSelectNode(m.id, "mapping")}
                    data-testid={`row-mapping-${m.id}`}
                  >
                    <TableCell className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span>{ROLE_ICONS[ct?.role ?? ""] ?? "•"}</span>
                        {ct?.name ?? "–"}
                      </span>
                    </TableCell>
                    <TableCell><code className="text-xs">{m.shopwareProductNumber}</code></TableCell>
                    <TableCell className="max-w-[280px] truncate">{m.productName ?? "–"}</TableCell>
                    <TableCell>{formatNum(m.productDetails?.height, "mm")}</TableCell>
                    <TableCell>{formatNum(m.productDetails?.depth, "mm")}</TableCell>
                    <TableCell>{formatNum(m.productDetails?.loadCapacity, "kg")}</TableCell>
                    <TableCell>
                      {m.productDetails?.price != null
                        ? m.productDetails.price.toLocaleString("de-DE", { style: "currency", currency: "EUR" })
                        : "–"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={statusBadge.className}>{statusBadge.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
      <div className="px-3 py-2 border-t text-xs text-muted-foreground shrink-0">
        {rows.length} von {mappings.length} {mappings.length === 1 ? "Artikel" : "Artikeln"}
      </div>
    </div>
  );
}
