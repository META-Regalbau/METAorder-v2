import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Role } from "@shared/schema";

interface B2BAssortmentsPageProps {
  userPermissions: Role["permissions"];
}

export default function B2BAssortmentsPage({ userPermissions }: B2BAssortmentsPageProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [skuSearch, setSkuSearch] = useState("");
  const [newSku, setNewSku] = useState({ customerProductNumber: "", productId: "" });
  const canView = userPermissions?.viewB2B;
  const canManage = userPermissions?.manageB2B;
  const search = useSearch();

  useEffect(() => {
    const params = new URLSearchParams(search.replace(/^\?/, ""));
    const cid = params.get("customerId");
    if (cid) setCustomerId(cid);
  }, [search]);

  const querySuffix = customerId.trim() ? `?customerId=${encodeURIComponent(customerId.trim())}` : "";

  const { data: assortmentsData } = useQuery<{ assortments: any[] }>({
    queryKey: ["/api/b2b/assortments", customerId],
    queryFn: async () => {
      const res = await fetch(`/api/b2b/assortments${querySuffix}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: canView && Boolean(customerId.trim()),
  });

  const { data: skusData } = useQuery<{ skus: any[] }>({
    queryKey: ["/api/b2b/customer-skus", customerId, skuSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (customerId.trim()) params.set("customerId", customerId.trim());
      if (skuSearch.trim()) params.set("search", skuSearch.trim());
      const res = await fetch(`/api/b2b/customer-skus?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: canView,
  });

  const createSkuMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/b2b/customer-skus", {
        customerId: customerId.trim(),
        productId: newSku.productId.trim(),
        customerProductNumber: newSku.customerProductNumber.trim(),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/b2b/customer-skus"] });
      setNewSku({ customerProductNumber: "", productId: "" });
      toast({ title: t("b2b.assortments.skuCreated") });
    },
    onError: (e: Error) => toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  if (!canView) {
    return <div className="p-6 text-muted-foreground">{t("b2b.noPermission")}</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("b2b.assortments.title")}</h1>
        <p className="text-muted-foreground">{t("b2b.assortments.subtitle")}</p>
      </div>

      <Input
        placeholder={t("b2b.assortments.customerIdPlaceholder")}
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
      />

      <Tabs defaultValue="prices">
        <TabsList>
          <TabsTrigger value="prices">{t("b2b.assortments.customerPrices")}</TabsTrigger>
          <TabsTrigger value="skus">{t("b2b.assortments.customerSkus")}</TabsTrigger>
        </TabsList>
        <TabsContent value="prices">
          <Card>
            <CardHeader><CardTitle>{t("b2b.assortments.customerPrices")}</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("b2b.productNumber")}</TableHead>
                    <TableHead>{t("b2b.price")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(assortmentsData?.assortments ?? []).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.productNumber || a.productId}</TableCell>
                      <TableCell>{a.price?.toLocaleString()} €</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="skus">
          <Card>
            <CardHeader><CardTitle>{t("b2b.assortments.customerSkus")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Input placeholder={t("b2b.search")} value={skuSearch} onChange={(e) => setSkuSearch(e.target.value)} />
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <Input
                    placeholder={t("b2b.assortments.customerSku")}
                    value={newSku.customerProductNumber}
                    onChange={(e) => setNewSku((s) => ({ ...s, customerProductNumber: e.target.value }))}
                  />
                  <Input
                    placeholder={t("b2b.assortments.productId")}
                    value={newSku.productId}
                    onChange={(e) => setNewSku((s) => ({ ...s, productId: e.target.value }))}
                  />
                  <Button
                    onClick={() => createSkuMutation.mutate()}
                    disabled={!customerId.trim() || createSkuMutation.isPending}
                  >
                    {t("b2b.add")}
                  </Button>
                </div>
              ) : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("b2b.assortments.customerSku")}</TableHead>
                    <TableHead>{t("b2b.productNumber")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(skusData?.skus ?? []).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.customerProductNumber}</TableCell>
                      <TableCell>{s.productNumber || s.productId}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
