import { useState } from "react";
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

const STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  customer_contact_required: "Customer Contact Required",
  rejected: "Rejected",
};

const STATUS_BADGE_VARIANTS: Record<ReviewStatus, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "secondary",
  approved: "default",
  customer_contact_required: "outline",
  rejected: "destructive",
};

function toReviewStatus(value: ReviewQueueItem["reviewStatus"]): ReviewStatus {
  return value === "not_required" ? "pending" : value;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("de-DE");
}

export default function CPQReviewQueuePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ReviewStatus>(CPQ_REVIEW_QUEUE_STATUS_VALUES[0]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [targetStatus, setTargetStatus] = useState<ReviewStatus>("approved");
  const [reviewNotes, setReviewNotes] = useState("");

  const queueQuery = useQuery<ReviewQueueItem[]>({
    queryKey: ["/api/cpq-core/review-queue", statusFilter],
    queryFn: async () => {
      const response = await fetch(`/api/cpq-core/review-queue?status=${statusFilter}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Review-Queue konnte nicht geladen werden");
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
        throw new Error("Review-Detail konnte nicht geladen werden");
      }
      return response.json();
    },
    enabled: !!selectedItemId,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItemId) throw new Error("Kein Queue-Eintrag ausgewählt");
      await apiRequest("PUT", `/api/cpq-core/review-queue/${selectedItemId}/status`, {
        status: targetStatus,
        reviewNotes: reviewNotes.trim() || null,
      });
    },
    onSuccess: async () => {
      toast({ title: "Status aktualisiert", description: "Der Queue-Eintrag wurde aktualisiert." });
      setReviewNotes("");
      await queryClient.invalidateQueries({ queryKey: ["/api/cpq-core/review-queue"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/cpq-core/review-queue/item", selectedItemId] });
    },
    onError: (error: Error) => {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
    },
  });

  const queueItems = queueQuery.data ?? [];
  const selectedItem = selectedItemQuery.data ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">CPQ Review Queue</h1>
        <p className="text-muted-foreground">Vertrieb verarbeitet hier Klasse-C-Konfigurationen.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle>Queue</CardTitle>
            <div className="w-64">
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value as ReviewStatus);
                  setSelectedItemId(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Status wählen" />
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
                Keine Einträge für den gewählten Status.
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Eingang</TableHead>
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
                        <TableCell>{formatDateTime(item.reviewRequestedAt ?? item.createdAt)}</TableCell>
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
            <CardTitle>Detail & Statuswechsel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedItemId ? (
              <p className="text-sm text-muted-foreground">Eintrag in der Queue auswählen.</p>
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
                  <div><span className="font-medium">Name:</span> {selectedItem.name}</div>
                  <div><span className="font-medium">System:</span> {selectedItem.systemId}</div>
                  <div><span className="font-medium">Kunde:</span> {selectedItem.customerId ?? "-"}</div>
                  <div><span className="font-medium">Aktueller Status:</span> {STATUS_LABELS[toReviewStatus(selectedItem.reviewStatus)]}</div>
                  <div><span className="font-medium">Letzte Prüfung:</span> {formatDateTime(selectedItem.reviewedAt)}</div>
                  <div><span className="font-medium">Geprüft von:</span> {selectedItem.reviewedBy ?? "-"}</div>
                </div>

                <div className="space-y-2">
                  <Label>Zielstatus</Label>
                  <Select value={targetStatus} onValueChange={(value) => setTargetStatus(value as ReviewStatus)}>
                    <SelectTrigger>
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
                  <Label htmlFor="review-notes">Review-Notiz</Label>
                  <Textarea
                    id="review-notes"
                    value={reviewNotes}
                    onChange={(event) => setReviewNotes(event.target.value)}
                    placeholder="z. B. Kunde für Rückfrage kontaktieren"
                    rows={6}
                  />
                </div>

                <Button
                  onClick={() => updateStatusMutation.mutate()}
                  disabled={updateStatusMutation.isPending}
                  className="w-full"
                >
                  {updateStatusMutation.isPending ? "Speichere..." : "Status speichern"}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Detail konnte nicht geladen werden.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
