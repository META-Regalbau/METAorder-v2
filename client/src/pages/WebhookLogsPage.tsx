import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { de, enUS, es } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { ArrowLeft, RefreshCw, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";

type WebhookLog = {
  id: string;
  eventType: string;
  url: string;
  statusCode: number | null;
  success: boolean;
  error: string | null;
  retryCount: number;
  createdAt: string;
};

export default function WebhookLogsPage() {
  const { i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const limit = 50;
  const offset = (page - 1) * limit;

  const { data: logsData, isLoading, refetch } = useQuery<{ logs: WebhookLog[]; total: number }>({
    queryKey: ['/api/webhooks/logs', limit, offset],
    queryFn: async () => {
      const res = await fetch(`/api/webhooks/logs?limit=${limit}&offset=${offset}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      return res.json();
    },
    retry: false,
  });

  const getStatusBadge = (log: WebhookLog) => {
    if (log.success) {
      return (
        <Badge variant="default" className="bg-green-600">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Success
        </Badge>
      );
    } else {
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    }
  };

  const locale = i18n.language === 'de' ? de : i18n.language === 'es' ? es : enUS;

  return (
    <div className="p-6 w-full">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon" data-testid="button-back-to-settings">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">Webhook Logs</h1>
            <p className="text-sm text-muted-foreground">
              Monitor webhook delivery status and troubleshoot issues
            </p>
          </div>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => refetch()}
          data-testid="button-refresh-logs"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="text-left p-3 text-sm font-medium">Timestamp</th>
                <th className="text-left p-3 text-sm font-medium">Event Type</th>
                <th className="text-left p-3 text-sm font-medium">URL</th>
                <th className="text-left p-3 text-sm font-medium">Status</th>
                <th className="text-left p-3 text-sm font-medium">Response</th>
                <th className="text-left p-3 text-sm font-medium">Retries</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    Loading logs...
                  </td>
                </tr>
              ) : logsData?.logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    No webhook logs found. Logs will appear here after webhooks are triggered.
                  </td>
                </tr>
              ) : (
                logsData?.logs.map((log) => (
                  <tr key={log.id} className="border-b hover-elevate" data-testid={`row-webhook-log-${log.id}`}>
                    <td className="p-3 text-sm">
                      <span className="text-muted-foreground">
                        {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true, locale })}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className="font-mono text-sm">{log.eventType}</span>
                    </td>
                    <td className="p-3">
                      <span className="font-mono text-xs text-muted-foreground truncate max-w-xs block">
                        {log.url}
                      </span>
                    </td>
                    <td className="p-3">{getStatusBadge(log)}</td>
                    <td className="p-3">
                      {log.statusCode ? (
                        <Badge variant="outline" className="font-mono">
                          {log.statusCode}
                        </Badge>
                      ) : log.error ? (
                        <div className="flex items-center gap-1 text-destructive">
                          <AlertCircle className="h-3 w-3" />
                          <span className="text-xs truncate max-w-xs">{log.error}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      {log.retryCount > 0 ? (
                        <Badge variant="secondary">{log.retryCount}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">0</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {logsData && logsData.total > limit && (
          <div className="p-4 border-t flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {(page - 1) * limit + 1} - {Math.min(page * limit, logsData.total)} of {logsData.total} logs
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                data-testid="button-previous-page"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page + 1)}
                disabled={page * limit >= logsData.total}
                data-testid="button-next-page"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
