import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { de, enUS, es } from "date-fns/locale";
import { 
  PlayCircle, 
  CheckCircle, 
  XCircle, 
  MinusCircle,
  Clock,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import type { ErpAutomationRun } from "@shared/schema";

interface ErpAutomationWidgetProps {
  userRole: "employee" | "admin";
}

export default function ErpAutomationWidget({ userRole }: ErpAutomationWidgetProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();

  // Get locale for date formatting
  const dateLocale = i18n.language === 'de' ? de : i18n.language === 'es' ? es : enUS;

  // Fetch automation history (last 20 runs)
  const { 
    data: automationRuns = [], 
    isLoading, 
    isError, 
    error,
    refetch 
  } = useQuery<ErpAutomationRun[]>({
    queryKey: ['/api/erp-automation/history'],
    queryFn: async () => {
      const response = await fetch('/api/erp-automation/history?limit=20&offset=0', {
        credentials: 'include',
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch automation history' }));
        throw new Error(errorData.error || 'Failed to fetch automation history');
      }
      return response.json();
    },
    // Only admins can view full history
    enabled: userRole === 'admin',
    refetchInterval: 60000, // Refresh every minute
  });

  // Manual trigger mutation
  const triggerMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/erp-automation/trigger', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to trigger automation');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t('erpAutomation.triggerSuccess.title', 'Automation Triggered'),
        description: t('erpAutomation.triggerSuccess.description', 'ERP automation polling started successfully'),
      });
      // Invalidate query to refetch automation history
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/erp-automation/history'] });
      }, 2000);
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: t('erpAutomation.triggerError.title', 'Trigger Failed'),
        description: error.message,
      });
    },
  });

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return (
          <Badge variant="default" className="gap-1 bg-green-600 hover:bg-green-700" data-testid={`badge-success`}>
            <CheckCircle className="w-3 h-3" />
            {t('erpAutomation.status.success', 'Success')}
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive" className="gap-1" data-testid={`badge-failed`}>
            <XCircle className="w-3 h-3" />
            {t('erpAutomation.status.failed', 'Failed')}
          </Badge>
        );
      case 'skipped':
        return (
          <Badge variant="secondary" className="gap-1" data-testid={`badge-skipped`}>
            <MinusCircle className="w-3 h-3" />
            {t('erpAutomation.status.skipped', 'Skipped')}
          </Badge>
        );
      default:
        return <Badge variant="outline" data-testid={`badge-unknown`}>{status}</Badge>;
    }
  };

  // Get action label
  const getActionLabel = (action: string) => {
    switch (action) {
      case 'create_invoice':
        return t('erpAutomation.action.createInvoice', 'Create Invoice');
      case 'set_shipped':
        return t('erpAutomation.action.setShipped', 'Set Shipped');
      case 'send_invoice':
        return t('erpAutomation.action.sendInvoice', 'Send Invoice');
      default:
        return action;
    }
  };

  // Get trigger label
  const getTriggerLabel = (trigger: string) => {
    switch (trigger) {
      case 'invoice_number':
        return t('erpAutomation.trigger.invoiceNumber', 'Invoice Number');
      case 'delivery_note':
        return t('erpAutomation.trigger.deliveryNote', 'Delivery Note');
      case 'order_number':
        return t('erpAutomation.trigger.orderNumber', 'Order Number');
      default:
        return trigger;
    }
  };

  if (userRole !== 'admin') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlayCircle className="w-5 h-5" />
            {t('erpAutomation.title', 'ERP Automation')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            {t('erpAutomation.adminOnly', 'This feature is only available to administrators')}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="flex items-center gap-2">
          <PlayCircle className="w-5 h-5" />
          {t('erpAutomation.title', 'ERP Automation')}
        </CardTitle>
        <Button 
          onClick={() => triggerMutation.mutate()} 
          disabled={triggerMutation.isPending}
          size="sm"
          variant="outline"
          className="gap-2"
          data-testid="button-trigger-automation"
        >
          <RefreshCw className={`w-4 h-4 ${triggerMutation.isPending ? 'animate-spin' : ''}`} />
          {t('erpAutomation.triggerManual', 'Trigger Now')}
        </Button>
      </CardHeader>
      <CardContent>
        {isError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t('erpAutomation.errorTitle', 'Failed to load automation history')}</AlertTitle>
            <AlertDescription className="mt-2">
              <p className="mb-2">{error instanceof Error ? error.message : t('erpAutomation.errorUnknown', 'An unknown error occurred')}</p>
              <Button 
                onClick={() => refetch()} 
                size="sm" 
                variant="outline"
                className="gap-2"
                data-testid="button-retry-fetch"
              >
                <RefreshCw className="w-3 h-3" />
                {t('erpAutomation.retry', 'Retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : automationRuns.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>{t('erpAutomation.noRuns', 'No automation runs yet')}</p>
            <p className="text-sm mt-1">
              {t('erpAutomation.pollInterval', 'Automation runs every 3 minutes')}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {automationRuns.map((run) => (
              <div
                key={run.id}
                className="flex items-start justify-between p-3 rounded-md border hover-elevate"
                data-testid={`automation-run-${run.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {getStatusBadge(run.status)}
                    <span className="font-medium text-sm" data-testid={`text-order-number-${run.id}`}>
                      {run.orderNumber || run.orderId}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium">{getTriggerLabel(run.trigger)}</span>
                    {' → '}
                    <span>{getActionLabel(run.action)}</span>
                  </div>
                  {run.errorMessage && (
                    <p className="text-sm text-destructive mt-1" data-testid={`text-error-${run.id}`}>
                      {run.errorMessage}
                    </p>
                  )}
                  {run.metadata?.skippedReason && (
                    <p className="text-sm text-muted-foreground mt-1" data-testid={`text-skipped-${run.id}`}>
                      {run.metadata.skippedReason}
                    </p>
                  )}
                </div>
                <div className="text-xs text-muted-foreground ml-4 flex-shrink-0" data-testid={`text-timestamp-${run.id}`}>
                  {formatDistanceToNow(new Date(run.executedAt), { 
                    addSuffix: true,
                    locale: dateLocale 
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 pt-4 border-t text-xs text-muted-foreground text-center">
          {t('erpAutomation.info', 'Automatically creates invoices and sets orders to shipped based on ERP CustomFields')}
        </div>
      </CardContent>
    </Card>
  );
}
