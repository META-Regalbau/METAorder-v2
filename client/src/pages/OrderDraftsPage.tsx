import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, FileText, Eye, Trash2, CheckCircle, AlertCircle, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  IMPORT_MATCHING_CONFIDENCE_WARNING_THRESHOLD,
  isLowOverallMatchingConfidence,
} from "@/lib/commercialDraftConfidence";
import { pickDocumentExtraction } from "@/components/DocumentExtractionAlerts";
import { format } from "date-fns";
import { de, enUS, es } from "date-fns/locale";
import { OrderDraftUploadDialog } from "@/components/OrderDraftUploadDialog";
import { OrderDraftReviewModal } from "@/components/OrderDraftReviewModal";
import { queryClient } from "@/lib/queryClient";
import { fetchOrderDraftForReview } from "@/lib/refreshReviewDraft";

interface OrderDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "pending" | "approved" | "review_required" | "rejected" | "created";
  createdByUserId: string | null;
  originalFileName: string;
  originalFilePath: string | null;
  extractedData: any;
  matchingResults: {
    items: Array<{
      extractedProductName: string;
      extractedProductNumber?: string;
      quantity: number;
      confidence: number;
      status: "matched" | "uncertain" | "not_found";
    }>;
    overallConfidence: number;
  } | null;
  shopwareCustomerId: string | null;
  shopwareOrderId: string | null;
}

export default function OrderDraftsPage() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedDraft, setSelectedDraft] = useState<OrderDraft | null>(null);

  const { data: drafts, isLoading, refetch } = useQuery<OrderDraft[]>({
    queryKey: ["/api/order-drafts"],
  });

  const lowConfidenceDrafts = useMemo(
    () => (drafts ?? []).filter((d) => isLowOverallMatchingConfidence(d.matchingResults)),
    [drafts]
  );

  const recipientIsMetaDrafts = useMemo(
    () =>
      (drafts ?? []).filter((d) => {
        const ext = pickDocumentExtraction(d.extractedData as Record<string, unknown> | null);
        return Boolean(ext?.document?.recipient_is_meta);
      }),
    [drafts]
  );

  const getDateLocale = () => {
    switch (i18n.language) {
      case "de":
        return de;
      case "es":
        return es;
      default:
        return enUS;
    }
  };

  const getStatusBadge = (status: OrderDraft["status"]) => {
    switch (status) {
      case "approved":
        return (
          <Badge variant="default" className="bg-green-600 hover:bg-green-700" data-testid={`badge-status-${status}`}>
            <CheckCircle className="w-3 h-3 mr-1" />
            {t("orderDrafts.status.approved")}
          </Badge>
        );
      case "review_required":
        return (
          <Badge variant="default" className="bg-yellow-600 hover:bg-yellow-700" data-testid={`badge-status-${status}`}>
            <AlertCircle className="w-3 h-3 mr-1" />
            {t("orderDrafts.status.reviewRequired")}
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="secondary" data-testid={`badge-status-${status}`}>
            {t("orderDrafts.status.pending")}
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="destructive" data-testid={`badge-status-${status}`}>
            <XCircle className="w-3 h-3 mr-1" />
            {t("orderDrafts.status.rejected")}
          </Badge>
        );
      case "created":
        return (
          <Badge variant="default" className="bg-blue-600 hover:bg-blue-700" data-testid={`badge-status-${status}`}>
            <CheckCircle className="w-3 h-3 mr-1" />
            {t("orderDrafts.status.created")}
          </Badge>
        );
    }
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 90) {
      return (
        <Badge variant="default" className="bg-green-600 hover:bg-green-700" data-testid="badge-confidence-high">
          {confidence}%
        </Badge>
      );
    } else if (confidence >= 60) {
      return (
        <Badge variant="default" className="bg-yellow-600 hover:bg-yellow-700" data-testid="badge-confidence-medium">
          {confidence}%
        </Badge>
      );
    } else {
      return (
        <Badge variant="destructive" data-testid="badge-confidence-low">
          {confidence}%
        </Badge>
      );
    }
  };

  return (
    <div className="w-full p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="heading-page-title">
            {t("orderDrafts.title")}
          </h1>
          <p className="text-muted-foreground mt-1" data-testid="text-page-description">
            {t("orderDrafts.description")}
          </p>
        </div>
        <Button onClick={() => setUploadDialogOpen(true)} data-testid="button-upload-document">
          <Upload className="w-4 h-4 mr-2" />
          {t("orderDrafts.uploadDocument")}
        </Button>
      </div>

      {recipientIsMetaDrafts.length > 0 && (
        <Alert
          variant="destructive"
          className="border-destructive/60"
          data-testid="alert-recipient-is-meta-list"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Empfänger ist META — vermutlich Lieferanten-AB</AlertTitle>
          <AlertDescription className="text-sm space-y-2">
            <p>
              {recipientIsMetaDrafts.length} Beleg(e) richten sich an einen META-Standort.
              Bitte prüfen, ob diese überhaupt als Kunden-Bestellung verarbeitet werden sollen.
            </p>
            <ul className="list-disc pl-4 space-y-0.5">
              {recipientIsMetaDrafts.map((d) => (
                <li key={`meta-${d.id}`}>
                  <span className="font-medium">{d.originalFileName}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {lowConfidenceDrafts.length > 0 && (
        <Alert
          variant="destructive"
          className="border-destructive/60"
          data-testid="alert-low-matching-imports"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>
            {t("drafts.importLowMatching.listTitle", "Import mit niedriger Zuordnungsgenauigkeit")}
          </AlertTitle>
          <AlertDescription className="text-sm space-y-2">
            <p>
              {t("drafts.importLowMatching.listBody", {
                defaultValue:
                  "{{count}} Entwurf/Entwürfe unter {{threshold}} % Gesamt-Genauigkeit — bitte im Review prüfen.",
                count: lowConfidenceDrafts.length,
                threshold: IMPORT_MATCHING_CONFIDENCE_WARNING_THRESHOLD,
              })}
            </p>
            <ul className="list-disc pl-4 space-y-0.5">
              {lowConfidenceDrafts.map((d) => (
                <li key={d.id}>
                  <span className="font-medium">{d.originalFileName}</span>
                  {d.matchingResults != null && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({d.matchingResults.overallConfidence}%)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground" data-testid="text-loading">
            {t("common.loading")}
          </div>
        ) : !drafts || drafts.length === 0 ? (
          <div className="p-8 text-center space-y-4">
            <FileText className="w-12 h-12 mx-auto text-muted-foreground" />
            <div>
              <p className="text-lg font-medium" data-testid="text-no-drafts">
                {t("orderDrafts.noDrafts")}
              </p>
              <p className="text-sm text-muted-foreground" data-testid="text-upload-hint">
                {t("orderDrafts.uploadHint")}
              </p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead data-testid="table-head-document">{t("orderDrafts.table.document")}</TableHead>
                <TableHead data-testid="table-head-uploaded">{t("orderDrafts.table.uploaded")}</TableHead>
                <TableHead data-testid="table-head-status">{t("orderDrafts.table.status")}</TableHead>
                <TableHead data-testid="table-head-confidence">{t("orderDrafts.table.confidence")}</TableHead>
                <TableHead data-testid="table-head-items">{t("orderDrafts.table.items")}</TableHead>
                <TableHead className="text-right" data-testid="table-head-actions">
                  {t("orderDrafts.table.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drafts.map((draft) => (
                <TableRow
                  key={draft.id}
                  data-testid={`row-draft-${draft.id}`}
                  className={
                    isLowOverallMatchingConfidence(draft.matchingResults)
                      ? "bg-destructive/5 border-l-4 border-l-destructive/70"
                      : undefined
                  }
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium" data-testid={`text-filename-${draft.id}`}>
                        {draft.originalFileName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell data-testid={`text-uploaded-${draft.id}`}>
                    {format(new Date(draft.createdAt), "Pp", { locale: getDateLocale() })}
                  </TableCell>
                  <TableCell>{getStatusBadge(draft.status)}</TableCell>
                  <TableCell>
                    {draft.matchingResults ? (
                      getConfidenceBadge(draft.matchingResults.overallConfidence)
                    ) : (
                      <Badge variant="secondary" data-testid="badge-no-matching">
                        {t("orderDrafts.noMatching")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell data-testid={`text-item-count-${draft.id}`}>
                    {draft.matchingResults?.items.length || 0} {t("orderDrafts.table.itemsCount")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedDraft(draft)}
                        data-testid={`button-review-${draft.id}`}
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        {t("orderDrafts.table.review")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <OrderDraftUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onUploadSuccess={(result) => {
          refetch();
          setUploadDialogOpen(false);
          if (result.draftKind === "order") {
            const od = result.draft as OrderDraft;
            setSelectedDraft(od);
            if (isLowOverallMatchingConfidence(od.matchingResults)) {
              const score = od.matchingResults?.overallConfidence;
              toast({
                variant: "destructive",
                title: t("drafts.importLowMatching.uploadToastTitle", {
                  defaultValue: "Import: Genauigkeit unter {{threshold}} %",
                  threshold: IMPORT_MATCHING_CONFIDENCE_WARNING_THRESHOLD,
                }),
                description: t("drafts.importLowMatching.uploadToastBody", {
                  defaultValue:
                    "Gesamt-Genauigkeit der Produktzuordnung: {{score}} %. Bitte alle Positionen im Review prüfen.",
                  score: typeof score === "number" ? score : "—",
                }),
              });
            }
          } else {
            void queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
            setLocation("/offers");
          }
        }}
      />

      {selectedDraft && (
        <OrderDraftReviewModal
          draft={selectedDraft}
          open={!!selectedDraft}
          onOpenChange={(open: boolean) => !open && setSelectedDraft(null)}
          onUpdate={() => {
            refetch();
            void fetchOrderDraftForReview(selectedDraft.id)
              .then(setSelectedDraft)
              .catch(() => setSelectedDraft(null));
          }}
        />
      )}
    </div>
  );
}
