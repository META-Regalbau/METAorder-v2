import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SalesChannelSelector } from "@/components/SalesChannelSelector";
import B2BCompanyDetailModal from "@/components/B2BCompanyDetailModal";
import type { Role, SalesChannel } from "@shared/schema";

type Company = {
  id: string;
  customerId: string | null;
  company: string;
  email: string;
  customerNumber: string | null;
  active: boolean;
  salesChannelId?: string | null;
  salesChannelName?: string | null;
  tags?: string[];
};

interface B2BAccountsPageProps {
  userPermissions: Role["permissions"];
  userRole: "employee" | "admin";
  userSalesChannelIds?: string[] | null;
}

export default function B2BAccountsPage({ userPermissions, userRole, userSalesChannelIds }: B2BAccountsPageProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedCompanyName, setSelectedCompanyName] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const canView = userPermissions?.viewB2B;

  const { data: salesChannels = [] } = useQuery<SalesChannel[]>({
    queryKey: ["/api/sales-channels"],
    retry: false,
  });

  useEffect(() => {
    if (salesChannels.length > 0 && selectedChannelIds.length === 0) {
      if (userRole === "admin" || !userSalesChannelIds) {
        setSelectedChannelIds(salesChannels.map((c) => c.id));
      } else {
        setSelectedChannelIds(userSalesChannelIds);
      }
    }
  }, [salesChannels, userRole, userSalesChannelIds, selectedChannelIds.length]);

  const { data: companiesData, isLoading: companiesLoading, isError: companiesError, error: companiesQueryError } = useQuery<{ companies: Company[]; total: number }>({
    queryKey: ["/api/b2b/companies", search, selectedChannelIds],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (selectedChannelIds.length > 0) params.set("salesChannelIds", selectedChannelIds.join(","));
      const q = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/b2b/companies${q}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: canView,
  });

  const { data: rolesData } = useQuery<{ roles: { id: string; name: string }[] }>({
    queryKey: ["/api/b2b/roles"],
    enabled: canView,
  });

  const openCompanyDetail = (company: Company) => {
    setSelectedCompanyId(company.customerId || company.id);
    setSelectedCompanyName(company.company);
    setDetailOpen(true);
  };

  const closeCompanyDetail = () => {
    setDetailOpen(false);
    setSelectedCompanyId(null);
    setSelectedCompanyName("");
  };

  if (!canView) {
    return <div className="p-6 text-muted-foreground">{t("b2b.noPermission")}</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("b2b.accounts.title")}</h1>
        <p className="text-muted-foreground">{t("b2b.accounts.subtitle")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("b2b.accounts.companies")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SalesChannelSelector
              selectedChannelIds={selectedChannelIds}
              onSelectionChange={setSelectedChannelIds}
              userAllowedChannelIds={userSalesChannelIds}
              isAdmin={userRole === "admin"}
              enabled={canView}
            />
            <Input
              className="sm:flex-1"
              placeholder={t("b2b.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {companiesError ? (
            <p className="text-sm text-destructive">
              {companiesQueryError instanceof Error ? companiesQueryError.message : t("b2b.loadError")}
            </p>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("b2b.company")}</TableHead>
                <TableHead>{t("b2b.email")}</TableHead>
                <TableHead>{t("b2b.customerNumber")}</TableHead>
                <TableHead>{t("b2b.accounts.tags")}</TableHead>
                <TableHead>{t("b2b.accounts.detail.salesChannel")}</TableHead>
                <TableHead>{t("b2b.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(companiesData?.companies ?? []).map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => openCompanyDetail(c)}
                >
                  <TableCell className="font-medium">{c.company || "—"}</TableCell>
                  <TableCell>{c.email || "—"}</TableCell>
                  <TableCell>{c.customerNumber || "—"}</TableCell>
                  <TableCell>
                    {(c.tags?.length ?? 0) > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {c.tags!.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{c.salesChannelName || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={c.active ? "default" : "secondary"}>
                      {c.active ? t("b2b.active") : t("b2b.inactive")}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {!companiesLoading && !companiesError && (companiesData?.companies?.length ?? 0) === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {t("b2b.noResults")}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {rolesData?.roles?.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("b2b.accounts.roles")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {rolesData.roles.map((r) => (
              <Badge key={r.id} variant="outline">{r.name}</Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <B2BCompanyDetailModal
        open={detailOpen}
        onClose={closeCompanyDetail}
        companyId={selectedCompanyId}
        companyName={selectedCompanyName}
        userPermissions={userPermissions}
      />
    </div>
  );
}
