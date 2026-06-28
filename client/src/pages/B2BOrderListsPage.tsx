import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Role } from "@shared/schema";

interface B2BOrderListsPageProps {
  userPermissions: Role["permissions"];
}

export default function B2BOrderListsPage({ userPermissions }: B2BOrderListsPageProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [customerId, setCustomerId] = useState("");
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [lastDraftId, setLastDraftId] = useState<string | null>(null);
  const canView = userPermissions?.viewB2B;
  const canManage = userPermissions?.manageB2B;

  const querySuffix = customerId.trim() ? `?customerId=${encodeURIComponent(customerId.trim())}` : "";

  const { data: listsData } = useQuery<{ lists: any[] }>({
    queryKey: ["/api/b2b/shopping-lists", customerId],
    queryFn: async () => {
      const res = await fetch(`/api/b2b/shopping-lists${querySuffix}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: canView,
  });

  const { data: itemsData } = useQuery<{ items: any[] }>({
    queryKey: ["/api/b2b/shopping-lists", selectedListId, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/b2b/shopping-lists/${selectedListId}/items`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: canView && Boolean(selectedListId),
  });

  const handleReorder = async () => {
    if (!selectedListId) return;
    const res = await apiRequest("POST", `/api/b2b/shopping-lists/${selectedListId}/reorder`, {
      customerId: customerId.trim() || undefined,
      createDraft: true,
    });
    if (!res.ok) {
      const err = await res.json();
      toast({ title: t("errors.failed"), description: err.error, variant: "destructive" });
      return;
    }
    const data = await res.json();
    setLastDraftId(data.draftId ?? null);
    toast({
      title: data.draftId ? t("b2b.orderLists.reorderDraftCreated") : t("b2b.orderLists.reorderPrepared"),
      description: `${data.lineItems?.length ?? 0} ${t("b2b.orderLists.positions")}`,
    });
  };

  if (!canView) {
    return <div className="p-6 text-muted-foreground">{t("b2b.noPermission")}</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("b2b.orderLists.title")}</h1>
        <p className="text-muted-foreground">{t("b2b.orderLists.subtitle")}</p>
      </div>

      <Input
        placeholder={t("b2b.assortments.customerIdPlaceholder")}
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("b2b.orderLists.lists")}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("b2b.orderLists.listName")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(listsData?.lists ?? []).map((l) => (
                  <TableRow
                    key={l.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedListId(l.id)}
                  >
                    <TableCell>{l.name || l.id}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t("b2b.orderLists.items")}</CardTitle>
            {canManage && selectedListId ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={handleReorder}>{t("b2b.orderLists.reorder")}</Button>
                {lastDraftId ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/order-drafts/${lastDraftId}`}>{t("b2b.orderLists.openDraft")}</Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("b2b.productNumber")}</TableHead>
                  <TableHead>{t("b2b.quantity")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(itemsData?.items ?? []).map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.productNumber || i.productId}</TableCell>
                    <TableCell>{i.quantity}</TableCell>
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
