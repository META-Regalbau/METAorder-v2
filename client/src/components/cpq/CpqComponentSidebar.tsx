/**
 * Komponenten-Sidebar – Suche + aufklappbare Gruppen nach Komponententyp
 * Original-Layout: 280px breit, Suche, Gruppen (Steher, Traversen, etc.)
 */

import { useState } from "react";
import { ChevronRight, Search } from "lucide-react";

const ROLE_ICONS: Record<string, string> = {
  frame: "📐",
  beam: "🔩",
  shelf: "📦",
  accessory: "🔧",
  connector: "🔗",
};

const ROLE_COLORS: Record<string, string> = {
  frame: "#4a7cff",
  beam: "#34d399",
  shelf: "#fbbf24",
  accessory: "#a78bfa",
  connector: "#22d3ee",
};

type CpqComponentType = {
  id: string;
  name: string;
  role: string;
};

type CpqProductMapping = {
  id: string;
  shopwareProductNumber: string;
  componentTypeId: string;
  productName?: string | null;
};

type CpqComponentSidebarProps = {
  componentTypes: CpqComponentType[];
  mappings: CpqProductMapping[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string, type: "component" | "mapping") => void;
};

export default function CpqComponentSidebar({
  componentTypes,
  mappings,
  selectedNodeId,
  onSelectNode,
}: CpqComponentSidebarProps) {
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(componentTypes[0]?.id ? [componentTypes[0].id] : []));

  const toggleGroup = (id: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = search.trim()
    ? componentTypes.map((ct) => ({
        ...ct,
        mappings: mappings
          .filter((m) => m.componentTypeId === ct.id && m.shopwareProductNumber.toLowerCase().includes(search.toLowerCase()))
          .slice(0, 20),
      })).filter((ct) => ct.mappings.length > 0 || ct.name.toLowerCase().includes(search.toLowerCase()))
    : componentTypes.map((ct) => ({
        ...ct,
        mappings: mappings.filter((m) => m.componentTypeId === ct.id),
      }));

  return (
    <div className="w-[280px] bg-muted/50 border-r flex flex-col overflow-hidden shrink-0">
      <div className="p-4 border-b">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">
          Komponenten
        </h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            className="w-full pl-9 pr-3 py-2 bg-background border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/50"
            placeholder="Suche nach Artikel..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {filtered.map((ct) => {
          const ctMappings = ct.mappings;
          const isOpen = openGroups.has(ct.id) || search.length > 0;
          const icon = ROLE_ICONS[ct.role] ?? "📦";
          const color = ROLE_COLORS[ct.role] ?? "#8899b8";

          return (
            <div key={ct.id} className="mb-1">
              <button
                type="button"
                onClick={() => toggleGroup(ct.id)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span>{icon} {ct.name}</span>
                <span className="ml-auto text-[11px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  {ctMappings.length}
                </span>
                <ChevronRight
                  className={`h-2.5 w-2.5 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
              </button>
              {isOpen && (
                <div className="pl-5 mt-0.5 space-y-0.5">
                  {ctMappings.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelectNode(m.id, "mapping")}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left text-xs transition-colors ${
                        selectedNodeId === m.id
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                      <span className="min-w-0 truncate">
                        <span className="font-mono">{m.shopwareProductNumber}</span>
                        {m.productName && <span className="text-muted-foreground block truncate font-normal">{m.productName}</span>}
                      </span>
                    </button>
                  ))}
                  {ctMappings.length === 0 && (
                    <p className="px-3 py-1.5 text-xs text-muted-foreground">Keine Artikel</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
