import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Role } from "@shared/schema";

interface B2BBudgetsPageProps {
  userPermissions: Role["permissions"];
}

export default function B2BBudgetsPage({ userPermissions }: B2BBudgetsPageProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canView = userPermissions?.viewB2B;
  const canApprove = userPermissions?.approveB2BBudgets;

  const { data: budgetsData, isLoading } = useQuery<{ budgets: any[]; total: number }>({
    queryKey: ["/api/b2b/budgets"],
    enabled: canView,
  });

  const { data: approvalsData } = useQuery<{ approvals: any[]; auditLog: any[] }>({
    queryKey: ["/api/b2b/approvals"],
    enabled: canView,
  });

  const decideMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "reject" }) => {
      const res = await apiRequest("POST", `/api/b2b/approvals/${id}/${action}`, {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/b2b/approvals"] });
      toast({ title: t("b2b.budgets.decisionSaved") });
    },
    onError: (e: Error) => {
      toast({ title: t("errors.failed"), description: e.message, variant: "destructive" });
    },
  });

  if (!canView) {
    return <div className="p-6 text-muted-foreground">{t("b2b.noPermission")}</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("b2b.budgets.title")}</h1>
        <p className="text-muted-foreground">{t("b2b.budgets.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("b2b.budgets.list")}</CardTitle>
        </CardHeader>
        <CardContent>
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
              {(budgetsData?.budgets ?? []).map((b) => (
                <TableRow key={b.id}>
                  <TableCell>{b.name}</TableCell>
                  <TableCell>{b.sum?.toLocaleString()} €</TableCell>
                  <TableCell>{b.periodType || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={b.active ? "default" : "secondary"}>
                      {b.active ? t("b2b.active") : t("b2b.inactive")}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && (budgetsData?.budgets?.length ?? 0) === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    {t("b2b.noResults")}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("b2b.budgets.approvalQueue")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("b2b.budgets.order")}</TableHead>
                <TableHead>{t("b2b.budgets.amount")}</TableHead>
                <TableHead>{t("b2b.status")}</TableHead>
                {canApprove ? <TableHead>{t("b2b.actions")}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(approvalsData?.approvals ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.orderNumber || a.id}</TableCell>
                  <TableCell>{a.totalPrice?.toLocaleString()} €</TableCell>
                  <TableCell>{a.status}</TableCell>
                  {canApprove ? (
                    <TableCell className="space-x-2">
                      <Button
                        size="sm"
                        onClick={() => decideMutation.mutate({ id: a.id, action: "approve" })}
                        disabled={decideMutation.isPending}
                      >
                        {t("b2b.approve")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decideMutation.mutate({ id: a.id, action: "reject" })}
                        disabled={decideMutation.isPending}
                      >
                        {t("b2b.reject")}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
