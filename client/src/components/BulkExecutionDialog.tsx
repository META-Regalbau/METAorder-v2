import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CrossSellingRule } from "@shared/schema";
import { CheckCircle2, XCircle, AlertCircle, Play } from "lucide-react";

interface BulkExecutionDialogProps {
  open: boolean;
  onClose: () => void;
  rules: CrossSellingRule[];
}

interface BulkExecutionResult {
  totalProducts: number;
  productsProcessed: number;
  crossSellingsCreated: number;
  productsSkipped: number;
  errors: Array<{ productId: string; productName: string; error: string }>;
}

export default function BulkExecutionDialog({ open, onClose, rules }: BulkExecutionDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [selectedRuleId, setSelectedRuleId] = useState<string>("all");
  const [executionResult, setExecutionResult] = useState<BulkExecutionResult | null>(null);

  const executeMutation = useMutation({
    mutationFn: async (ruleId?: string) => {
      const body = ruleId && ruleId !== "all" ? { ruleId } : {};
      const response = await apiRequest("POST", "/api/cross-selling-rules/execute-bulk", body);
      return await response.json() as BulkExecutionResult;
    },
    onSuccess: (result) => {
      setExecutionResult(result);
      toast({
        title: t('rules.bulkExecutionComplete'),
        description: t('rules.bulkExecutionCompleteDescription', {
          created: result.crossSellingsCreated,
          total: result.totalProducts,
        }),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('rules.bulkExecutionError'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    setSelectedRuleId("all");
    setExecutionResult(null);
    onClose();
  };

  const handleExecute = () => {
    const ruleId = selectedRuleId === "all" ? undefined : selectedRuleId;
    executeMutation.mutate(ruleId);
  };

  const activeRules = rules.filter(r => r.active);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-3xl" data-testid="dialog-bulk-execution">
        <DialogHeader>
          <DialogTitle>{t('rules.bulkExecutionTitle')}</DialogTitle>
          <DialogDescription>{t('rules.bulkExecutionDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {!executionResult && !executeMutation.isPending && (
            <>
              <div className="space-y-2">
                <Label htmlFor="rule-select">{t('rules.selectRule')}</Label>
                <Select value={selectedRuleId} onValueChange={setSelectedRuleId}>
                  <SelectTrigger id="rule-select" data-testid="select-rule">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" data-testid="option-all-rules">
                      {t('rules.allActiveRules')} ({activeRules.length})
                    </SelectItem>
                    {activeRules.map((rule) => (
                      <SelectItem key={rule.id} value={rule.id} data-testid={`option-rule-${rule.id}`}>
                        {rule.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="p-4 border rounded-md bg-muted/50">
                <p className="text-sm text-muted-foreground">
                  {t('rules.bulkExecutionWarning')}
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleClose} data-testid="button-cancel">
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleExecute} data-testid="button-start-execution">
                  <Play className="h-4 w-4 mr-2" />
                  {t('rules.startExecution')}
                </Button>
              </div>
            </>
          )}

          {executeMutation.isPending && (
            <div className="space-y-4">
              <div className="flex items-center justify-center py-8">
                <div className="text-center space-y-4">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                  <p className="text-sm text-muted-foreground">{t('rules.executing')}</p>
                </div>
              </div>
            </div>
          )}

          {executionResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Card className="p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="text-sm text-muted-foreground">{t('rules.crossSellingsCreated')}</p>
                      <p className="text-2xl font-bold" data-testid="text-created-count">
                        {executionResult.crossSellingsCreated}
                      </p>
                    </div>
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-yellow-600" />
                    <div>
                      <p className="text-sm text-muted-foreground">{t('rules.productsSkipped')}</p>
                      <p className="text-2xl font-bold" data-testid="text-skipped-count">
                        {executionResult.productsSkipped}
                      </p>
                    </div>
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-blue-600" />
                    <div>
                      <p className="text-sm text-muted-foreground">{t('rules.productsProcessed')}</p>
                      <p className="text-2xl font-bold" data-testid="text-processed-count">
                        {executionResult.productsProcessed} / {executionResult.totalProducts}
                      </p>
                    </div>
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-red-600" />
                    <div>
                      <p className="text-sm text-muted-foreground">{t('rules.errors')}</p>
                      <p className="text-2xl font-bold" data-testid="text-error-count">
                        {executionResult.errors.length}
                      </p>
                    </div>
                  </div>
                </Card>
              </div>

              {executionResult.errors.length > 0 && (
                <Card className="p-4">
                  <h4 className="font-medium mb-2">{t('rules.errorDetails')}</h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {executionResult.errors.map((error, idx) => (
                      <div
                        key={idx}
                        className="text-sm p-2 bg-destructive/10 border border-destructive/20 rounded"
                        data-testid={`error-${idx}`}
                      >
                        <p className="font-medium">{error.productName}</p>
                        <p className="text-xs text-muted-foreground">{error.error}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              <div className="flex justify-end">
                <Button onClick={handleClose} data-testid="button-close">
                  {t('common.close')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
