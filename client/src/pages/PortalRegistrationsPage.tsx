import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Loader2, RefreshCw, Upload, UserPlus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { queryClient } from "@/lib/queryClient";
import { apiErrorFromBody } from "@/lib/apiError";
import { getCommercialUploadCsrfHeaders } from "@/lib/commercialUnifiedDraftUpload";
import type { Role } from "@shared/schema";
import type { PortalRegistrationListItem, PortalRegistrationStatus } from "@shared/portalRegistrations";
import RegistrationDetailDialog from "@/components/portalRegistrations/RegistrationDetailDialog";
import RegistrationSettingsTab from "@/components/portalRegistrations/RegistrationSettingsTab";
import SalesRepTab from "@/components/portalRegistrations/SalesRepTab";
import { registrationStatusVariant } from "@/components/portalRegistrations/status";

/**
 * Portal-Registrierungen: Anmeldungen fürs Händlerportal aus dem Registrierungs-Postfach (über n8n).
 * Liste nach Status, Prüffenster je Anmeldung, Außendienst-Zuordnung und Einstellungen.
 * Server: server/b2b/portalRegistrationRoutes.ts.
 */

type ListResponse = { items: PortalRegistrationListItem[]; counts: Record<string, number> };

const FILTERS: Record<string, PortalRegistrationStatus[]> = {
  open: ["review", "ready", "failed", "processing"],
  waiting: ["waiting_master_data"],
  completed: ["completed"],
  discarded: ["discarded"],
  all: [],
};
type FilterKey = keyof typeof FILTERS;

interface PortalRegistrationsPageProps {
  userPermissions?: Role["permissions"];
  userRole?: string;
}

export default function PortalRegistrationsPage({ userPermissions, userRole }: PortalRegistrationsPageProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const search = useSearch();
  const [, navigate] = useLocation();
  const canManage = userRole === "admin" || Boolean(userPermissions?.manageB2B);
  const [tab, setTab] = useState("registrations");
  const [filter, setFilter] = useState<FilterKey>("open");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedId = new URLSearchParams(search).get("id");
  const openDetail = (id: string | null) => navigate(id ? `/b2b/registrations?id=${encodeURIComponent(id)}` : "/b2b/registrations");

  const statusParam = FILTERS[filter].join(",");
  const listQuery = useQuery<ListResponse>({
    queryKey: [`/api/b2b/registrations${statusParam ? `?status=${statusParam}` : ""}`],
    refetchInterval: 30_000,
  });
  const counts = listQuery.data?.counts ?? {};
  const countFor = (key: FilterKey) =>
    FILTERS[key].length ? FILTERS[key].reduce((sum, s) => sum + (counts[s] ?? 0), 0) : Object.values(counts).reduce((a, b) => a + b, 0);

  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/b2b/registrations") });

  const uploadMail = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const res = await fetch("/api/b2b/registrations/upload", {
        method: "POST",
        body: form,
        credentials: "include",
        headers: getCommercialUploadCsrfHeaders(),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw apiErrorFromBody(res.status, body, t("portalRegistrations.uploadFailed"));
      toast({ title: t("portalRegistrations.uploaded", { outcome: t(`portalRegistrations.outcomes.${body?.intake?.outcome ?? "review"}`) }) });
      await refresh();
      if (body?.intake?.registrationId) openDetail(body.intake.registrationId);
    } catch (err) {
      toast({ title: t("portalRegistrations.uploadFailed"), description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold mb-1 flex items-center gap-2">
            <UserPlus className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            {t("portalRegistrations.title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">{t("portalRegistrations.subtitle")}</p>
        </div>
        {tab === "registrations" ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refresh()} data-testid="button-registrations-refresh">
              <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
              {t("portalRegistrations.refresh")}
            </Button>
            {canManage ? (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".eml,.msg"
                  className="hidden"
                  aria-label={t("portalRegistrations.uploadMail")}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadMail(file);
                  }}
                />
                <Button onClick={() => fileInput.current?.click()} disabled={uploading} data-testid="button-registration-upload">
                  {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4 mr-2" aria-hidden="true" />}
                  {t("portalRegistrations.uploadMail")}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="registrations" data-testid="tab-registrations">{t("portalRegistrations.tabs.registrations")}</TabsTrigger>
          <TabsTrigger value="salesReps" data-testid="tab-sales-reps">{t("portalRegistrations.tabs.salesReps")}</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-registration-settings">{t("portalRegistrations.tabs.settings")}</TabsTrigger>
        </TabsList>

        <TabsContent value="registrations" className="space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("portalRegistrations.filterLabel")}>
            {(Object.keys(FILTERS) as FilterKey[]).map((key) => (
              <Button
                key={key}
                size="sm"
                variant={filter === key ? "default" : "outline"}
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                data-testid={`filter-registrations-${key}`}
              >
                {t(`portalRegistrations.filters.${key}`)}
                <span className="ml-2 tabular-nums">{fmt.integer(countFor(key))}</span>
              </Button>
            ))}
          </div>

          <Card>
            {listQuery.isLoading ? (
              <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t("common.loading")}
              </div>
            ) : listQuery.error ? (
              <p className="p-6 text-sm text-destructive">{(listQuery.error as Error).message}</p>
            ) : (listQuery.data?.items.length ?? 0) === 0 ? (
              <p className="p-6 text-sm text-muted-foreground" data-testid="registrations-empty">{t("portalRegistrations.empty")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("portalRegistrations.columns.received")}</TableHead>
                    <TableHead>{t("portalRegistrations.columns.company")}</TableHead>
                    <TableHead>{t("portalRegistrations.columns.contact")}</TableHead>
                    <TableHead>{t("portalRegistrations.columns.customer")}</TableHead>
                    <TableHead>{t("portalRegistrations.columns.expertMode")}</TableHead>
                    <TableHead>{t("portalRegistrations.columns.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listQuery.data!.items.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      onClick={() => openDetail(item.id)}
                      data-testid={`row-registration-${item.id}`}
                    >
                      <TableCell className="whitespace-nowrap text-sm">
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(item.id);
                          }}
                        >
                          {fmt.dateTime(item.receivedAt)}
                        </button>
                        {item.forwardedBy ? <div className="text-xs text-muted-foreground">{t("portalRegistrations.via", { name: item.forwardedBy })}</div> : null}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{item.company ?? t("portalRegistrations.unknownCompany")}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[280px]">{item.subject}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{item.contactName ?? "–"}</div>
                        <div className="text-xs text-muted-foreground">{item.contactEmail ?? ""}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.matchedCustomerNumber ? (
                          <span className="font-medium">{item.matchedCustomerNumber}</span>
                        ) : item.customerNumber ? (
                          <span className="text-muted-foreground">{t("portalRegistrations.fromMail", { number: item.customerNumber })}</span>
                        ) : (
                          "–"
                        )}
                        {item.matchStatus ? (
                          <div className="text-xs text-muted-foreground">
                            {t(`portalRegistrations.match.${item.matchStatus}`)}
                            {item.confidence ? ` · ${fmt.percentValue(item.confidence, 0)}` : ""}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {item.expertMode === true ? <Badge variant="secondary">{t("portalRegistrations.expertYes")}</Badge> : <span className="text-muted-foreground">–</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={registrationStatusVariant(item.status)}>{t(`portalRegistrations.statuses.${item.status}`)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="salesReps">
          <SalesRepTab canManage={canManage} />
        </TabsContent>

        <TabsContent value="settings">
          <RegistrationSettingsTab canManage={canManage} />
        </TabsContent>
      </Tabs>

      {selectedId ? <RegistrationDetailDialog id={selectedId} canManage={canManage} onClose={() => openDetail(null)} onChanged={refresh} /> : null}
    </div>
  );
}
