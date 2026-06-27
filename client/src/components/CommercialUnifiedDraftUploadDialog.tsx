import { useState, useCallback, useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Image, Mail, CheckCircle, AlertCircle } from "lucide-react";
import {
  postCommercialUnifiedDraft,
  validateCommercialDraftFile,
  isStaleFileHandleError,
  COMMERCIAL_DRAFT_FILE_ACCEPT,
  type CommercialUnifiedUploadResult,
} from "@/lib/commercialUnifiedDraftUpload";

export type { CommercialUnifiedUploadResult };

function pageContextFromI18nPrefix(i18nPrefix: string): "dashboard" | "offer" | "order" {
  if (i18nPrefix.startsWith("dashboard.")) return "dashboard";
  if (i18nPrefix.startsWith("offerDrafts")) return "offer";
  return "order";
}

interface CommercialUnifiedDraftUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefix for title, description, dropzone, validation keys (e.g. dashboard.commercialUpload, offerDrafts.upload) */
  i18nPrefix: string;
  showContextFields?: boolean;
  onSuccess: (result: CommercialUnifiedUploadResult) => void;
  dataTestId?: string;
}

export function CommercialUnifiedDraftUploadDialog({
  open,
  onOpenChange,
  i18nPrefix,
  showContextFields = false,
  onSuccess,
  dataTestId = "dialog-commercial-unified-upload",
}: CommercialUnifiedDraftUploadDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const inputId = useId();
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [subject, setSubject] = useState("");
  const [bodyNote, setBodyNote] = useState("");

  const pageCtx = pageContextFromI18nPrefix(i18nPrefix);
  const showOrderInfoBanner = pageCtx === "order";

  useEffect(() => {
    if (!open) {
      setSelectedFile(null);
      setUploadProgress(0);
      setSubject("");
      setBodyNote("");
      setDragActive(false);
    }
  }, [open]);

  const buildSuccessToastDescription = (data: CommercialUnifiedUploadResult) => {
    const intentKey = `commercialUpload.intent.${data.commercialIntent}`;
    const intentLabel = t(intentKey, { defaultValue: data.commercialIntent });
    const confPct = Math.round((data.commercialIntentConfidence ?? 0) * 100);
    const parts: string[] = [
      t("commercialUpload.toast.lineIntent", {
        intent: intentLabel,
        confidence: confPct,
      }),
      t(
        data.draftKind === "order"
          ? "commercialUpload.toast.lineSavedAsOrder"
          : "commercialUpload.toast.lineSavedAsOffer"
      ),
    ];
    if (data.intentRoutedAsOfferDueToPermission) {
      parts.push(t("commercialUpload.toast.permissionRoutedToOffer"));
    }
    const mismatchOffer =
      pageCtx === "offer" && data.draftKind === "order" && !data.intentRoutedAsOfferDueToPermission;
    const mismatchOrder = pageCtx === "order" && data.draftKind === "offer";
    if (mismatchOffer) parts.push(t("commercialUpload.toast.pageMismatchOfferPage"));
    if (mismatchOrder) parts.push(t("commercialUpload.toast.pageMismatchOrderPage"));
    return parts.filter(Boolean).join(" ");
  };

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setUploadProgress(20);
      const result = await postCommercialUnifiedDraft(file, {
        subject,
        body: bodyNote,
      });
      setUploadProgress(95);
      return result;
    },
    onSuccess: (data) => {
      toast({
        title: t("commercialUpload.toast.successTitle"),
        description: buildSuccessToastDescription(data),
      });
      setUploadProgress(100);
      setSelectedFile(null);
      onSuccess(data);
    },
    onError: (error: Error) => {
      if (isStaleFileHandleError(error)) {
        toast({
          title: t(`${i18nPrefix}.error`),
          description: error.message,
          variant: "destructive",
          duration: 12000,
        });
        setSelectedFile(null);
        setUploadProgress(0);
        return;
      }
      toast({
        title: t(`${i18nPrefix}.error`),
        description: error.message,
        variant: "destructive",
      });
      setUploadProgress(0);
    },
  });

  useEffect(() => {
    if (open) uploadMutation.reset();
    // Nur bei Dialog-Öffnung zurücksetzen (Mutation-Instanz absichtlich nicht in deps)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const uploadButtonLabelKey = i18nPrefix.includes("orderDrafts") ? "startUpload" : "upload";

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const validateAndSetFile = (file: File) => {
    const v = validateCommercialDraftFile(file);
    if (!v.ok) {
      if (v.reason === "type") {
        toast({
          title: t(`${i18nPrefix}.invalidFileType`),
          description: t(`${i18nPrefix}.invalidFileTypeDescription`),
          variant: "destructive",
        });
      } else {
        toast({
          title: t(`${i18nPrefix}.fileTooLarge`),
          description: t(`${i18nPrefix}.fileTooLargeDescription`),
          variant: "destructive",
        });
      }
      return;
    }
    setSelectedFile(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) validateAndSetFile(e.dataTransfer.files[0]);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) validateAndSetFile(e.target.files[0]);
  };

  const handleUpload = () => {
    if (!selectedFile || uploadMutation.isPending) return;
    uploadMutation.mutate(selectedFile);
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) {
      return <Image className="w-8 h-8 text-blue-600" />;
    }
    if (file.type === "application/pdf") {
      return <FileText className="w-8 h-8 text-red-600" />;
    }
    return <Mail className="w-8 h-8 text-green-600" />;
  };

  const tk = (key: string) => t(`${i18nPrefix}.${key}`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" data-testid={dataTestId}>
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">{tk("title")}</DialogTitle>
          <DialogDescription data-testid="text-dialog-description">{tk("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {showContextFields && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor={`${inputId}-subject`}>{tk("subjectOptional")}</Label>
                <Input
                  id={`${inputId}-subject`}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={tk("subjectPlaceholder")}
                  disabled={uploadMutation.isPending}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${inputId}-body`}>{tk("bodyOptional")}</Label>
                <Textarea
                  id={`${inputId}-body`}
                  value={bodyNote}
                  onChange={(e) => setBodyNote(e.target.value)}
                  placeholder={tk("bodyPlaceholder")}
                  rows={3}
                  disabled={uploadMutation.isPending}
                />
              </div>
            </div>
          )}

          {!selectedFile ? (
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragActive
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50"
              }`}
              data-testid="dropzone-commercial-unified"
            >
              <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium mb-2" data-testid="text-dropzone-title">
                {tk("dropzone.title")}
              </p>
              <p className="text-sm text-muted-foreground mb-4" data-testid="text-dropzone-hint">
                {tk("dropzone.hint")}
              </p>
              <Button variant="secondary" asChild data-testid="button-select-file">
                <label htmlFor={`${inputId}-file`} className="cursor-pointer">
                  {tk("selectFile")}
                  <input
                    id={`${inputId}-file`}
                    type="file"
                    className="hidden"
                    accept={COMMERCIAL_DRAFT_FILE_ACCEPT}
                    onChange={handleFileInput}
                  />
                </label>
              </Button>
              <p className="text-xs text-muted-foreground mt-4" data-testid="text-supported-formats">
                {tk("supportedFormats")}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 border rounded-lg" data-testid="card-selected-file">
                {getFileIcon(selectedFile)}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate" data-testid="text-selected-filename">
                    {selectedFile.name}
                  </p>
                  <p className="text-sm text-muted-foreground" data-testid="text-selected-filesize">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedFile(null)}
                  disabled={uploadMutation.isPending}
                  data-testid="button-remove-file"
                >
                  {t("common.remove")}
                </Button>
              </div>

              {showOrderInfoBanner && !uploadMutation.isPending && (
                <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm space-y-1">
                    <p className="font-medium text-blue-900 dark:text-blue-100" data-testid="text-info-title">
                      {t("orderDrafts.upload.info.title")}
                    </p>
                    <p className="text-blue-700 dark:text-blue-300" data-testid="text-info-description">
                      {t("orderDrafts.upload.info.description")}
                    </p>
                  </div>
                </div>
              )}

              {uploadMutation.isPending && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Progress value={uploadProgress} className="h-2" data-testid="progress-upload" />
                    </div>
                    <span className="text-sm text-muted-foreground" data-testid="text-upload-percentage">
                      {uploadProgress}%
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground text-center" data-testid="text-processing">
                    {tk("processing")}
                  </p>
                </div>
              )}

              {uploadMutation.isSuccess && (
                <div className="flex items-center gap-2 text-green-600 p-3 bg-green-50 rounded-lg" data-testid="alert-success">
                  <CheckCircle className="w-5 h-5" />
                  <p className="text-sm font-medium" data-testid="text-success-message">
                    {t(`${i18nPrefix}.successMessage`, { defaultValue: t(`${i18nPrefix}.success`) })}
                  </p>
                </div>
              )}

              {uploadMutation.isError && (
                <div className="flex items-center gap-2 text-red-600 p-3 bg-red-50 rounded-lg" data-testid="alert-error">
                  <AlertCircle className="w-5 h-5" />
                  <p className="text-sm font-medium" data-testid="text-error-message">
                    {uploadMutation.error?.message ||
                      t(`${i18nPrefix}.errorMessage`, { defaultValue: t(`${i18nPrefix}.error`) })}
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => (uploadMutation.isPending ? undefined : setSelectedFile(null))}
                  disabled={uploadMutation.isPending}
                  data-testid="button-cancel"
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={uploadMutation.isPending || uploadMutation.isSuccess}
                  data-testid="button-upload"
                >
                  {uploadMutation.isPending ? tk("uploading") : tk(uploadButtonLabelKey)}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
