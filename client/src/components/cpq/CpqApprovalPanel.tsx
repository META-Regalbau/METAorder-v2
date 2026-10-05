/**
 * CpqApprovalPanel - Freigabe-Status und Aktionen für Rabatt-Ampel
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { CheckCircle, XCircle } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";

type CpqApprovalPanelProps = {
  offerId: string;
  canApprove?: boolean;
  onApproved?: () => void;
  onRejected?: () => void;
};

export default function CpqApprovalPanel({
  offerId,
  canApprove = false,
  onApproved,
  onRejected,
}: CpqApprovalPanelProps) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const [comment, setComment] = useState("");

  const { data: approvalStatus, refetch } = useQuery<{
    id: string;
    approvalStatus: string;
    approvalType: string;
    discountPercent: string;
    listPrice: string;
    discountedPrice: string;
    revenueLoss: string;
    justification: string | null;
    approvedBy: string | null;
    approvalComment: string | null;
    approvedAt: string | null;
    createdAt: string;
  } | null>({
    queryKey: ["/api/cpq/offers", offerId, "approval-status"],
    queryFn: async () => {
      const res = await fetch(`/api/cpq/offers/${offerId}/approval-status`, { credentials: "include" });
      if (res.status === 404 || !res.ok) return null;
      const data = await res.json();
      return data;
    },
    enabled: !!offerId,
  });

  const approveMutation = useMutation({
    mutationFn: async (action: "approve" | "reject") => {
      const res = await apiRequest("PUT", `/api/cpq/offers/${offerId}/approve`, { action, comment });
      if (!res.ok) throw new Error("Failed to process approval");
      return res.json();
    },
    onSuccess: (_, action) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cpq/offers", offerId, "approval-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/offers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/offers/${offerId}`] });
      setComment("");
      action === "approve" ? onApproved?.() : onRejected?.();
    },
  });

  if (!approvalStatus) return null;

  const status = approvalStatus.approvalStatus;
  const isPending = status === "pending";
  const isApproved = status === "approved";
  const isRejected = status === "rejected";

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">{t("cpq.approval.title")}</h4>
        <Badge
          variant={isApproved ? "default" : isRejected ? "destructive" : "secondary"}
        >
          {isPending && t("cpq.approval.statusPending")}
          {isApproved && t("cpq.approval.statusApproved")}
          {isRejected && t("cpq.approval.statusRejected")}
        </Badge>
      </div>
      <div className="text-sm text-muted-foreground space-y-1">
        <p>{t("cpq.approval.summary", { discount: fmt.percentValue(Number(approvalStatus.discountPercent), 1), revenueLoss: fmt.currency(Number(approvalStatus.revenueLoss)) })}</p>
        {approvalStatus.justification && <p>{t("cpq.approval.justification", { text: approvalStatus.justification })}</p>}
        {isApproved && approvalStatus.approvedBy && (
          <p>{approvalStatus.approvedAt ? t("cpq.approval.approvedByAt", { name: approvalStatus.approvedBy, date: fmt.dateTime(approvalStatus.approvedAt) }) : t("cpq.approval.approvedBy", { name: approvalStatus.approvedBy })}</p>
        )}
        {isRejected && approvalStatus.approvalComment && (
          <p>{t("cpq.approval.rejection", { text: approvalStatus.approvalComment })}</p>
        )}
      </div>
      {isPending && canApprove && (
        <div className="space-y-2 pt-2 border-t">
          <Label>{t("cpq.approval.commentLabel")}</Label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("cpq.approval.commentPlaceholder")}
            rows={2}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => approveMutation.mutate("approve")}
              disabled={approveMutation.isPending}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {t("cpq.approval.approve")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => approveMutation.mutate("reject")}
              disabled={approveMutation.isPending}
            >
              <XCircle className="h-4 w-4 mr-2" />
              {t("cpq.approval.reject")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
