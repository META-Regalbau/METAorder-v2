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
        <h4 className="font-semibold">CPQ Rabatt-Freigabe</h4>
        <Badge
          variant={isApproved ? "default" : isRejected ? "destructive" : "secondary"}
        >
          {isPending && "Wartet auf Freigabe"}
          {isApproved && "Freigegeben"}
          {isRejected && "Abgelehnt"}
        </Badge>
      </div>
      <div className="text-sm text-muted-foreground space-y-1">
        <p>Rabatt: {Number(approvalStatus.discountPercent).toFixed(1)}% · Umsatzverlust: €{Number(approvalStatus.revenueLoss).toFixed(2)}</p>
        {approvalStatus.justification && <p>Begründung: {approvalStatus.justification}</p>}
        {isApproved && approvalStatus.approvedBy && (
          <p>Freigegeben von {approvalStatus.approvedBy} {approvalStatus.approvedAt && `am ${new Date(approvalStatus.approvedAt).toLocaleString()}`}</p>
        )}
        {isRejected && approvalStatus.approvalComment && (
          <p>Ablehnung: {approvalStatus.approvalComment}</p>
        )}
      </div>
      {isPending && canApprove && (
        <div className="space-y-2 pt-2 border-t">
          <Label>Kommentar (optional)</Label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Kommentar zur Freigabe/Ablehnung"
            rows={2}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => approveMutation.mutate("approve")}
              disabled={approveMutation.isPending}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Freigeben
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => approveMutation.mutate("reject")}
              disabled={approveMutation.isPending}
            >
              <XCircle className="h-4 w-4 mr-2" />
              Ablehnen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
