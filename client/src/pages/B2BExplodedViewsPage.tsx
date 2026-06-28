import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Role } from "@shared/schema";

interface B2BExplodedViewsPageProps {
  userPermissions: Role["permissions"];
}

export default function B2BExplodedViewsPage({ userPermissions }: B2BExplodedViewsPageProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const canView = userPermissions?.viewB2B;

  const { data: viewsData } = useQuery<{ views: any[] }>({
    queryKey: ["/api/b2b/exploded-views", search],
    queryFn: async () => {
      const q = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
      const res = await fetch(`/api/b2b/exploded-views${q}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: canView,
  });

  const { data: itemsData } = useQuery<{ items: any[] }>({
    queryKey: ["/api/b2b/exploded-views", selectedViewId, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/b2b/exploded-views/${selectedViewId}/items`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: canView && Boolean(selectedViewId),
  });

  if (!canView) {
    return <div className="p-6 text-muted-foreground">{t("b2b.noPermission")}</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("b2b.explodedViews.title")}</h1>
        <p className="text-muted-foreground">{t("b2b.explodedViews.subtitle")}</p>
      </div>

      <Input placeholder={t("b2b.search")} value={search} onChange={(e) => setSearch(e.target.value)} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("b2b.explodedViews.views")}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("b2b.name")}</TableHead>
                  <TableHead>{t("b2b.productNumber")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(viewsData?.views ?? []).map((v) => (
                  <TableRow key={v.id} className="cursor-pointer" onClick={() => setSelectedViewId(v.id)}>
                    <TableCell>{v.name}</TableCell>
                    <TableCell>{v.productId || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("b2b.explodedViews.parts")}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("b2b.explodedViews.label")}</TableHead>
                  <TableHead>{t("b2b.productNumber")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(itemsData?.items ?? []).map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.label || "—"}</TableCell>
                    <TableCell>{i.productNumber || i.productId}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
