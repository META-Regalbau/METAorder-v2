import { useQuery } from "@tanstack/react-query";
import { X, CheckCircle, XCircle, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";

interface ExecutionHistoryDialogProps {
  ruleId: string;
  onClose: () => void;
}

type AutomationExecution = {
  id: string;
  ruleId: string;
  executedAt: Date;
  success: boolean;
  executionData: string | null;
  errorMessage: string | null;
};

export function ExecutionHistoryDialog({ ruleId, onClose }: ExecutionHistoryDialogProps) {
  const { t } = useTranslation();

  const { data: executions = [], isLoading } = useQuery<AutomationExecution[]>({
    queryKey: ["/api/automation-rules", ruleId, "executions"],
    enabled: !!ruleId,
  });

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            {t('automation.executionHistory')}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : executions.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">{t('automation.noExecutions')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {executions.map((execution) => {
              const executionData = execution.executionData
                ? JSON.parse(execution.executionData)
                : null;

              return (
                <Card key={execution.id} className="p-4" data-testid={`execution-${execution.id}`}>
                  <div className="flex items-start gap-3">
                    {execution.success ? (
                      <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant={execution.success ? "success" : "destructive"}>
                          {execution.success ? t('automation.success') : t('automation.failed')}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(execution.executedAt).toLocaleString()}
                        </span>
                      </div>

                      {executionData && (
                        <div className="mb-2">
                          <p className="text-sm">
                            <span className="font-medium">{t('automation.action')}:</span>{' '}
                            {executionData.action || t('common.unknown')}
                          </p>
                        </div>
                      )}

                      {execution.errorMessage && (
                        <div className="mt-2 p-2 bg-destructive/10 rounded text-sm text-destructive">
                          {execution.errorMessage}
                        </div>
                      )}

                      {executionData && (
                        <details className="mt-2">
                          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                            {t('automation.viewDetails')}
                          </summary>
                          <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                            {JSON.stringify(executionData, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose} data-testid="button-close-history">
            {t('common.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
