import type { ReactNode } from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Role } from "@shared/schema";

export type B2BCompanyCustomerPrice = {
  id: string;
  productId: string | null;
  productNumber: string | null;
  productName: string | null;
  from: number | null;
  to: number | null;
  priceNet: number | null;
  pseudoPriceNet: number | null;
  discountPercent: number | null;
  currencyIsoCode: string | null;
  validFrom: string | null;
  validUntil: string | null;
};

export type B2BCompanyDetail = {
  offerCustomerId: string | null;
  customerId: string;
  company: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  customerNumber: string | null;
  active: boolean;
  accountType: string | null;
  vatIds: string[];
  phoneNumber: string | null;
  lastLogin: string | null;
  orderCount: number | null;
  orderTotalAmount: number | null;
  createdAt: string | null;
  customFields: Record<string, unknown> | null;
  billingAddress: {
    company: string | null;
    firstName: string | null;
    lastName: string | null;
    street: string;
    zipCode: string;
    city: string;
    country: string | null;
    phoneNumber: string | null;
  } | null;
  salesChannelName: string | null;
  customerGroupName: string | null;
  employees: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    department: string | null;
    phoneNumber: string | null;
    active: boolean;
    createdAt: string | null;
  }[];
  budgets: {
    id: string;
    name: string;
    sum: number;
    periodType: string | null;
    active: boolean;
  }[];
  customerPrices: {
    available: boolean;
    total: number;
    pluginDetected: boolean;
    prices: B2BCompanyCustomerPrice[];
  };
};

type B2BCompanyDetailModalProps = {
  open: boolean;
  onClose: () => void;
  companyId: string | null;
  companyName?: string;
  userPermissions?: Role["permissions"];
};

const dateFormatter = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const currencyFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value ?? "—"}</dd>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

export default function B2BCompanyDetailModal({
  open,
  onClose,
  companyId,
  companyName,
  userPermissions,
}: B2BCompanyDetailModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManage = userPermissions?.manageB2B;
  const [employeeToDelete, setEmployeeToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const { data, isLoading, isError, error } = useQuery<B2BCompanyDetail>({
    queryKey: ["/api/b2b/companies", companyId, "detail"],
    queryFn: async () => {
      const res = await fetch(`/api/b2b/companies/${companyId}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      return res.json();
    },
    enabled: open && Boolean(companyId),
  });

  const employeeActionMutation = useMutation({
    mutationFn: async ({
      employeeId,
      action,
    }: {
      employeeId: string;
      action: "activate" | "deactivate" | "delete";
    }) => {
      const res =
        action === "delete"
          ? await apiRequest("DELETE", `/api/b2b/employees/${employeeId}`)
          : await apiRequest("POST", `/api/b2b/employees/${employeeId}/${action}`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/b2b/companies", companyId, "detail"] });
      queryClient.invalidateQueries({ queryKey: ["/api/b2b/companies"] });
      const title =
        variables.action === "activate"
          ? t("b2b.accounts.detail.employeeActivated")
          : variables.action === "deactivate"
            ? t("b2b.accounts.detail.employeeDeactivated")
            : t("b2b.accounts.detail.employeeDeleted");
      toast({ title });
      if (variables.action === "delete") {
        setEmployeeToDelete(null);
      }
    },
    onError: (e: Error) => {
      toast({
        title: t("b2b.accounts.detail.employeeActionFailed"),
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const contactName = [data?.firstName, data?.lastName].filter(Boolean).join(" ").trim();
  const customFieldEntries = data?.customFields
    ? Object.entries(data.customFields).filter(([, v]) => v !== null && v !== undefined && v !== "")
    : [];

  return (
    <>
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data?.company || companyName || t("b2b.accounts.detail.title")}</DialogTitle>
          <DialogDescription>{t("b2b.accounts.detail.subtitle")}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}

        {isError ? (
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : t("b2b.loadError")}
          </p>
        ) : null}

        {data ? (
          <div className="space-y-6">
            <section className="flex flex-wrap items-center gap-2">
              <Badge variant={data.active ? "default" : "secondary"}>
                {data.active ? t("b2b.active") : t("b2b.inactive")}
              </Badge>
              {data.accountType ? (
                <Badge variant="outline">{data.accountType}</Badge>
              ) : null}
            </section>

            <section>
              <h3 className="mb-3 text-sm font-semibold">{t("b2b.accounts.detail.masterData")}</h3>
              <dl className="grid gap-4 sm:grid-cols-2">
                <DetailField label={t("b2b.company")} value={data.company} />
                <DetailField label={t("b2b.customerNumber")} value={data.customerNumber} />
                <DetailField label={t("b2b.email")} value={data.email} />
                <DetailField label={t("b2b.accounts.detail.contactPerson")} value={contactName || "—"} />
                <DetailField label={t("b2b.accounts.detail.phone")} value={data.phoneNumber} />
                <DetailField label={t("b2b.accounts.detail.customerGroup")} value={data.customerGroupName} />
                <DetailField label={t("b2b.accounts.detail.salesChannel")} value={data.salesChannelName} />
                <DetailField
                  label={t("b2b.accounts.detail.vatIds")}
                  value={data.vatIds.length ? data.vatIds.join(", ") : "—"}
                />
                <DetailField label={t("b2b.accounts.detail.createdAt")} value={formatDate(data.createdAt)} />
                <DetailField label={t("b2b.accounts.detail.lastLogin")} value={formatDate(data.lastLogin)} />
                <DetailField label={t("b2b.accounts.detail.orderCount")} value={data.orderCount ?? "—"} />
                <DetailField
                  label={t("b2b.accounts.detail.orderTotal")}
                  value={data.orderTotalAmount != null ? currencyFormatter.format(data.orderTotalAmount) : "—"}
                />
                <DetailField label={t("b2b.accounts.detail.customerId")} value={data.customerId} />
                {data.offerCustomerId ? (
                  <DetailField label={t("b2b.accounts.detail.offerCustomerId")} value={data.offerCustomerId} />
                ) : null}
              </dl>
            </section>

            {data.billingAddress ? (
              <section>
                <h3 className="mb-3 text-sm font-semibold">{t("b2b.accounts.detail.billingAddress")}</h3>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <DetailField label={t("b2b.company")} value={data.billingAddress.company} />
                  <DetailField
                    label={t("b2b.name")}
                    value={[data.billingAddress.firstName, data.billingAddress.lastName].filter(Boolean).join(" ") || "—"}
                  />
                  <DetailField label={t("b2b.accounts.detail.street")} value={data.billingAddress.street} />
                  <DetailField
                    label={t("b2b.accounts.detail.city")}
                    value={[data.billingAddress.zipCode, data.billingAddress.city].filter(Boolean).join(" ") || "—"}
                  />
                  <DetailField label={t("b2b.accounts.detail.country")} value={data.billingAddress.country} />
                  <DetailField label={t("b2b.accounts.detail.phone")} value={data.billingAddress.phoneNumber} />
                </dl>
              </section>
            ) : null}

            {customFieldEntries.length > 0 ? (
              <section>
                <h3 className="mb-3 text-sm font-semibold">{t("b2b.accounts.detail.customFields")}</h3>
                <dl className="grid gap-4 sm:grid-cols-2">
                  {customFieldEntries.map(([key, value]) => (
                    <DetailField
                      key={key}
                      label={key.replace(/^b2b_/, "").replace(/_/g, " ")}
                      value={typeof value === "boolean" ? (value ? t("b2b.active") : t("b2b.inactive")) : String(value)}
                    />
                  ))}
                </dl>
              </section>
            ) : null}

            <Separator />

            <section>
              <h3 className="mb-3 text-sm font-semibold">
                {t("b2b.accounts.employees")} ({data.employees.length})
              </h3>
              {data.employees.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("b2b.name")}</TableHead>
                      <TableHead>{t("b2b.email")}</TableHead>
                      <TableHead>{t("b2b.department")}</TableHead>
                      <TableHead>{t("b2b.status")}</TableHead>
                      {canManage ? (
                        <TableHead className="text-right">{t("b2b.accounts.detail.employeeActions")}</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.employees.map((employee) => (
                      <TableRow key={employee.id}>
                        <TableCell>{`${employee.firstName} ${employee.lastName}`.trim()}</TableCell>
                        <TableCell>{employee.email}</TableCell>
                        <TableCell>{employee.department || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={employee.active ? "default" : "secondary"}>
                            {employee.active ? t("b2b.active") : t("b2b.inactive")}
                          </Badge>
                        </TableCell>
                        {canManage ? (
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-1">
                              {employee.active ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={employeeActionMutation.isPending}
                                  onClick={() =>
                                    employeeActionMutation.mutate({
                                      employeeId: employee.id,
                                      action: "deactivate",
                                    })
                                  }
                                >
                                  {t("b2b.accounts.detail.deactivateEmployee")}
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={employeeActionMutation.isPending}
                                  onClick={() =>
                                    employeeActionMutation.mutate({
                                      employeeId: employee.id,
                                      action: "activate",
                                    })
                                  }
                                >
                                  {t("b2b.accounts.detail.activateEmployee")}
                                </Button>
                              )}
                              <Button
                                variant="destructive"
                                size="sm"
                                disabled={employeeActionMutation.isPending}
                                onClick={() =>
                                  setEmployeeToDelete({
                                    id: employee.id,
                                    name: `${employee.firstName} ${employee.lastName}`.trim() || employee.email,
                                  })
                                }
                              >
                                {t("b2b.accounts.detail.deleteEmployee")}
                              </Button>
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">{t("b2b.noResults")}</p>
              )}
            </section>

            {data.budgets.length > 0 ? (
              <section>
                <h3 className="mb-3 text-sm font-semibold">
                  {t("b2b.budgets.list")} ({data.budgets.length})
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("b2b.budgets.name")}</TableHead>
                      <TableHead>{t("b2b.budgets.amount")}</TableHead>
                      <TableHead>{t("b2b.budgets.period")}</TableHead>
                      <TableHead>{t("b2b.status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.budgets.map((budget) => (
                      <TableRow key={budget.id}>
                        <TableCell>{budget.name}</TableCell>
                        <TableCell>{currencyFormatter.format(budget.sum)}</TableCell>
                        <TableCell>{budget.periodType || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={budget.active ? "default" : "secondary"}>
                            {budget.active ? t("b2b.active") : t("b2b.inactive")}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            ) : null}

            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {t("b2b.accounts.detail.customerPrices")} ({data.customerPrices?.total ?? 0})
                </h3>
                {data.customerId ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/b2b/assortments?customerId=${encodeURIComponent(data.customerId)}`}>
                      {t("b2b.accounts.detail.openAssortments")}
                    </Link>
                  </Button>
                ) : null}
              </div>
              {!data.customerPrices?.pluginDetected ? (
                <p className="text-sm text-muted-foreground">{t("b2b.accounts.detail.pricesPluginMissing")}</p>
              ) : (data.customerPrices?.prices?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">{t("crm.customer.individualPrices.empty")}</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {t("crm.customer.individualPrices.summary", { count: data.customerPrices.total })}
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("crm.customer.individualPrices.product")}</TableHead>
                        <TableHead>{t("crm.customer.individualPrices.productNumber")}</TableHead>
                        <TableHead className="text-right">{t("crm.customer.individualPrices.quantity")}</TableHead>
                        <TableHead className="text-right">{t("b2b.accounts.detail.listPriceNet")}</TableHead>
                        <TableHead className="text-right">{t("crm.customer.individualPrices.priceNet")}</TableHead>
                        <TableHead className="text-right">{t("b2b.accounts.detail.discountPercent")}</TableHead>
                        <TableHead>{t("crm.customer.individualPrices.validity")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.customerPrices.prices.map((price) => (
                        <TableRow key={price.id}>
                          <TableCell>{price.productName || "—"}</TableCell>
                          <TableCell className="font-mono">{price.productNumber || "—"}</TableCell>
                          <TableCell className="text-right">
                            {price.from != null ? `${price.from}${price.to != null ? `–${price.to}` : "+"}` : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {price.pseudoPriceNet != null ? currencyFormatter.format(price.pseudoPriceNet) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {price.priceNet != null ? currencyFormatter.format(price.priceNet) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {price.discountPercent != null ? `${price.discountPercent.toLocaleString("de-DE")} %` : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {price.validFrom || price.validUntil
                              ? `${price.validFrom ? new Date(price.validFrom).toLocaleDateString("de-DE") : "—"} – ${price.validUntil ? new Date(price.validUntil).toLocaleDateString("de-DE") : "—"}`
                              : t("crm.customer.individualPrices.alwaysValid")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>

    <AlertDialog open={Boolean(employeeToDelete)} onOpenChange={(next) => !next && setEmployeeToDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("b2b.accounts.detail.deleteEmployeeTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("b2b.accounts.detail.deleteEmployeeDescription")}
            {employeeToDelete ? ` (${employeeToDelete.name})` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={employeeActionMutation.isPending}
            onClick={() => {
              if (employeeToDelete) {
                employeeActionMutation.mutate({ employeeId: employeeToDelete.id, action: "delete" });
              }
            }}
          >
            {t("b2b.accounts.detail.deleteEmployee")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
  );
}
