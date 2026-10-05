import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import type { LocaleFormatters } from "@/lib/localeFormat";
import {
  CPQ_REVIEW_QUEUE_STATUS_VALUES,
  type CpqReviewQueueStatus,
  type CpqReviewStatus,
} from "@shared/schema";

type ReviewStatus = CpqReviewQueueStatus;

type ReviewQueueItem = {
  id: string;
  name: string;
  systemId: string;
  customerId: string | null;
  reviewStatus: CpqReviewStatus;
  reviewRequired: boolean;
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewRequestedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  configData: Record<string, unknown> | null;
};

const STATUSES: ReviewStatus[] = [...CPQ_REVIEW_QUEUE_STATUS_VALUES];

const STATUS_BADGE_VARIANTS: Record<ReviewStatus, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "secondary",
  approved: "default",
  customer_contact_required: "outline",
  rejected: "destructive",
};

function toReviewStatus(value: ReviewQueueItem["reviewStatus"]): ReviewStatus {
  return value === "not_required" ? "pending" : value;
}

function formatDateTime(value: string | null, fmt: LocaleFormatters): string {
  if (!value) return "-";
  return fmt.dateTime(value) || value;
}

export default function CPQReviewQueuePage() {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ReviewStatus>(CPQ_REVIEW_QUEUE_STATUS_VALUES[0]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [targetStatus, setTargetStatus] = useState<ReviewStatus>("approved");
  const [reviewNotes, setReviewNotes] = useState("");

  const STATUS_LABELS: Record<ReviewStatus, string> = {
    pending: t("cpq.review.status.pending"),
    approved: t("cpq.review.status.approved"),
    customer_contact_required: t("cpq.review.status.customerContactRequired"),
    rejected: t("cpq.review.status.rejected"),
  };

  const queueQuery = useQuery<ReviewQueueItem[]>({
    queryKey: ["/api/cpq-core/review-queue", statusFilter],
    queryFn: async () => {
      const response = await fetch(`/api/cpq-core/review-queue?status=${statusFilter}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(t("cpq.review.errors.loadQueue"));
      }
      return response.json();
    },
  });

  const selectedItemQuery = useQuery<ReviewQueueItem>({
    queryKey: ["/api/cpq-core/review-queue/item", selectedItemId],
    queryFn: async () => {
      const response = await fetch(`/api/cpq-core/review-queue/${selectedItemId}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(t("cpq.review.errors.loadDetail"));
      }
      return response.json();
    },
    enabled: !!selectedItemId,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItemId) throw new Error(t("cpq.review.errors.noEntrySelected"));
      await apiRequest("PUT", `/api/cpq-core/review-queue/${selectedItemId}/status`, {
        status: targetStatus,
        reviewNotes: reviewNotes.trim() || null,
      });
    },
    onSuccess: async () => {
      toast({ title: t("cpq.review.toast.statusUpdated"), description: t("cpq.review.toast.statusUpdatedDescription") });
      setReviewNotes("");
      await queryClient.invalidateQueries({ queryKey: ["/api/cpq-core/review-queue"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/cpq-core/review-queue/item", selectedItemId] });
    },
    onError: (error: Error) => {
      toast({ title: t("cpq.review.toast.error"), description: error.message, variant: "destructive" });
    },
  });

  const queueItems = queueQuery.data ?? [];
  const selectedItem = selectedItemQuery.data ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("cpq.review.title")}</h1>
        <p className="text-muted-foreground">{t("cpq.review.subtitle")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle>{t("cpq.review.queueTitle")}</CardTitle>
            <div className="w-64">
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value as ReviewStatus);
                  setSelectedItemId(null);
                }}
              >
                <SelectTrigger aria-label={t("cpq.review.selectStatus")}>
                  <SelectValue placeholder={t("cpq.review.selectStatus")} />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {queueQuery.error ? (
              <div className="rounded border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                {(queueQuery.error as Error).message}
              </div>
            ) : queueQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : queueItems.length === 0 ? (
              <div className="rounded border bg-muted/30 p-4 text-sm text-muted-foreground">
                {t("cpq.review.empty")}
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("cpq.review.columns.name")}</TableHead>
                      <TableHead>{t("cpq.review.columns.status")}</TableHead>
                      <TableHead>{t("cpq.review.columns.received")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queueItems.map((item) => (
                      <TableRow
                        key={item.id}
                        className={selectedItemId === item.id ? "bg-muted/40" : "cursor-pointer"}
                        onClick={() => {
                          setSelectedItemId(item.id);
                          setReviewNotes(item.reviewNotes ?? "");
                          if (item.reviewStatus !== "not_required") {
                            setTargetStatus(item.reviewStatus);
                          }
                        }}
                      >
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_BADGE_VARIANTS[toReviewStatus(item.reviewStatus)]}>
                            {STATUS_LABELS[toReviewStatus(item.reviewStatus)]}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDateTime(item.reviewRequestedAt ?? item.createdAt, fmt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("cpq.review.detailTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedItemId ? (
              <p className="text-sm text-muted-foreground">{t("cpq.review.selectEntryHint")}</p>
            ) : selectedItemQuery.error ? (
              <p className="text-sm text-destructive">{(selectedItemQuery.error as Error).message}</p>
            ) : selectedItemQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : selectedItem ? (
              <>
                <div className="space-y-1 text-sm">
                  <div><span className="font-medium">{t("cpq.review.detail.name")}</span> {selectedItem.name}</div>
                  <div><span className="font-medium">{t("cpq.review.detail.system")}</span> {selectedItem.systemId}</div>
                  <div><span className="font-medium">{t("cpq.review.detail.customer")}</span> {selectedItem.customerId ?? "-"}</div>
                  <div><span className="font-medium">{t("cpq.review.detail.currentStatus")}</span> {STATUS_LABELS[toReviewStatus(selectedItem.reviewStatus)]}</div>
                  <div><span className="font-medium">{t("cpq.review.detail.lastReview")}</span> {formatDateTime(selectedItem.reviewedAt, fmt)}</div>
                  <div><span className="font-medium">{t("cpq.review.detail.reviewedBy")}</span> {selectedItem.reviewedBy ?? "-"}</div>
                </div>

                <div className="space-y-2">
                  <Label>{t("cpq.review.targetStatus")}</Label>
                  <Select value={targetStatus} onValueChange={(value) => setTargetStatus(value as ReviewStatus)}>
                    <SelectTrigger aria-label={t("cpq.review.targetStatus")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="review-notes">{t("cpq.review.reviewNote")}</Label>
                  <Textarea
                    id="review-notes"
                    value={reviewNotes}
                    onChange={(event) => setReviewNotes(event.target.value)}
                    placeholder={t("cpq.review.reviewNotePlaceholder")}
                    rows={6}
                  />
                </div>

                <Button
                  onClick={() => updateStatusMutation.mutate()}
                  disabled={updateStatusMutation.isPending}
                  className="w-full"
                >
                  {updateStatusMutation.isPending ? t("cpq.review.saving") : t("cpq.review.saveStatus")}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("cpq.review.detailLoadFailed")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
