import { useQuery } from "@tanstack/react-query";
import { CheckCircle, XCircle, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";

interface ExecutionHistoryDialogProps {
  ruleId: string;
  onClose: () => void;
}

// So speichert server/automation/engine.ts eine Ausfuehrung (Tabelle automation_executions)
type ExecutionResult = {
  trigger?: string;
  entity?: { type: string; id: string; number?: string } | null;
  actions?: Array<{ type: string; ok: boolean; message: string }>;
};

type AutomationExecution = {
  id: string;
  ruleId: string;
  executedAt: string;
  status: "success" | "failure" | string;
  result: ExecutionResult | null;
  error: string | null;
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
              const success = execution.status === "success";
              const result = execution.result;

              return (
                <Card key={execution.id} className="p-4" data-testid={`execution-${execution.id}`}>
                  <div className="flex items-start gap-3">
                    {success ? (
                      <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge variant={success ? "success" : "destructive"}>
                          {success ? t('automation.success') : t('automation.failed')}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(execution.executedAt).toLocaleString()}
                        </span>
                        {result?.entity?.number && (
                          <span className="text-xs text-muted-foreground">
                            {t('automation.history.ticket')} {result.entity.number}
                          </span>
                        )}
                      </div>

                      {result?.actions && result.actions.length > 0 && (
                        <ul className="space-y-1 text-sm">
                          {result.actions.map((a, i) => (
                            <li key={i} className="flex items-start gap-2">
                              {a.ok ? (
                                <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                              ) : (
                                <XCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                              )}
                              <span>
                                <span className="font-medium">{t(`automation.actions.${a.type}`, a.type)}:</span> {a.message}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {execution.error && !result?.actions?.length && (
                        <div className="mt-2 p-2 bg-destructive/10 rounded text-sm text-destructive">
                          {execution.error}
                        </div>
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
