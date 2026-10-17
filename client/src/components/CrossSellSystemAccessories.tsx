// Standardzubehör ohne Maß je Regalsystem: Vorschlag aus Bestellungen, einmal freigeben,
// gilt dann fest für alle Regale des Systems (Tab "Das passt dazu" beim nächsten Regel-Lauf).
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import ProductAutocomplete from "@/components/ProductAutocomplete";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";

type ProposalItem = { productNumber: string; name: string; orders: number; customers: number; share: number; recommended: boolean };
type Response = {
  proposals: Array<{ system: string; shelfOrders: number; items: ProposalItem[] }>;
  approved: Record<string, Array<{ productNumber: string; name: string | null }>>;
};
type Row = { productNumber: string; name: string | null; stats?: ProposalItem };

const KEY = ["/api/cross-selling/name-rules/accessory-proposals"];

export default function CrossSellSystemAccessories() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const [open, setOpen] = useState(false);
  const { data, isFetching } = useQuery<Response>({
    queryKey: KEY,
    queryFn: async () => (await apiRequest("GET", "/api/cross-selling/name-rules/accessory-proposals")).json(),
    enabled: open,
  });
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const [extra, setExtra] = useState<Record<string, Row[]>>({});
  const [adding, setAdding] = useState<Record<string, string>>({});

  // Zeilen je System: freigegebene + Vorschläge (+ von Hand hinzugefügte)
  const systems = useMemo(() => {
    if (!data) return [] as Array<{ system: string; shelfOrders: number | null; rows: Row[] }>;
    const names = new Set([...data.proposals.map((p) => p.system), ...Object.keys(data.approved)]);
    return Array.from(names).map((system) => {
      const proposal = data.proposals.find((p) => p.system === system);
      const rows: Row[] = [];
      const push = (r: Row) => {
        if (!rows.some((x) => x.productNumber === r.productNumber)) rows.push(r);
      };
      for (const a of data.approved[system] ?? []) push({ ...a, stats: proposal?.items.find((i) => i.productNumber === a.productNumber) });
      for (const i of proposal?.items ?? []) push({ productNumber: i.productNumber, name: i.name, stats: i });
      for (const r of extra[system] ?? []) push(r);
      return { system, shelfOrders: proposal?.shelfOrders ?? null, rows };
    });
  }, [data, extra]);

  // Vorauswahl: bisher Freigegebenes, sonst die gut belegten Vorschläge
  useEffect(() => {
    if (!data) return;
    const initial: Record<string, string[]> = {};
    for (const s of systems) {
      initial[s.system] = data.approved[s.system]
        ? data.approved[s.system].map((a) => a.productNumber)
        : s.rows.filter((r) => r.stats?.recommended).map((r) => r.productNumber);
    }
    setSelection(initial);
    // nur beim Laden der Daten
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const value = Object.fromEntries(Object.entries(selection).filter(([, list]) => list.length > 0));
      return (await apiRequest("PUT", "/api/cross-selling/automation-settings", { nameRuleSystemAccessories: value })).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/automation-settings"] });
      toast({ title: t("crossSellSystemAccessories.saved"), description: t("crossSellSystemAccessories.savedHint") });
    },
    onError: (e: Error) => toast({ title: t("crossSellSystemAccessories.saveError"), description: e.message, variant: "destructive" }),
  });

  const toggle = (system: string, pn: string, on: boolean) =>
    setSelection((prev) => {
      const list = new Set(prev[system] ?? []);
      if (on) list.add(pn);
      else list.delete(pn);
      // Reihenfolge wie angezeigt beibehalten
      const order = systems.find((s) => s.system === system)?.rows.map((r) => r.productNumber) ?? [];
      return { ...prev, [system]: order.filter((x) => list.has(x)) };
    });

  const addManual = (system: string) => {
    const pn = (adding[system] ?? "").trim();
    if (!pn) return;
    setExtra((prev) => ({ ...prev, [system]: [...(prev[system] ?? []), { productNumber: pn, name: null }] }));
    setSelection((prev) => ({ ...prev, [system]: [...(prev[system] ?? []).filter((x) => x !== pn), pn] }));
    setAdding((prev) => ({ ...prev, [system]: "" }));
  };

  return (
    <div className="space-y-3 border-t pt-3" data-testid="cross-sell-system-accessories">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h4 className="text-sm font-semibold">{t("crossSellSystemAccessories.title")}</h4>
          <p className="text-xs text-muted-foreground">{t("crossSellSystemAccessories.hint")}</p>
        </div>
        {!open ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {t("crossSellSystemAccessories.load")}
          </Button>
        ) : (
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !data}>
            {t("crossSellSystemAccessories.approve")}
          </Button>
        )}
      </div>
      {open && isFetching && <p className="text-xs text-muted-foreground">{t("common.loading")}</p>}
      {open && data && systems.length === 0 && <p className="text-xs text-muted-foreground">{t("crossSellSystemAccessories.empty")}</p>}
      {open &&
        systems.map((s) => (
          <div key={s.system} className="space-y-1">
            <div className="text-sm font-medium">
              {s.system}
              {s.shelfOrders !== null && (
                <span className="text-xs text-muted-foreground"> · {t("crossSellSystemAccessories.shelfOrders", { count: s.shelfOrders })}</span>
              )}
              {data?.approved[s.system] && <Badge variant="secondary" className="ml-2">{t("crossSellSystemAccessories.approved")}</Badge>}
            </div>
            <ul className="space-y-1">
              {s.rows.map((r) => {
                const id = `acc-${s.system}-${r.productNumber}`;
                return (
                  <li key={r.productNumber} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      id={id}
                      checked={(selection[s.system] ?? []).includes(r.productNumber)}
                      onCheckedChange={(v) => toggle(s.system, r.productNumber, v === true)}
                    />
                    <label htmlFor={id} className="cursor-pointer">
                      <span className="font-mono">{r.productNumber}</span> {r.name ?? ""}
                      {r.stats && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {t("crossSellSystemAccessories.stats", { share: fmt.percent(r.stats.share, 0), customers: r.stats.customers })}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <div className="w-[320px]">
                <ProductAutocomplete
                  value={adding[s.system] ?? ""}
                  onChange={(v) => setAdding((prev) => ({ ...prev, [s.system]: v }))}
                  placeholder={t("crossSellSystemAccessories.addPlaceholder")}
                />
              </div>
              <Button size="sm" variant="outline" onClick={() => addManual(s.system)} disabled={!(adding[s.system] ?? "").trim()}>
                {t("crossSellSystemAccessories.add")}
              </Button>
            </div>
          </div>
        ))}
    </div>
  );
}
