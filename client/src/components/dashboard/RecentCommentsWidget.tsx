import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { de, enUS, es } from "date-fns/locale";

interface TicketComment {
  id: string;
  ticketId: string;
  userId: string;
  username: string;
  comment: string;
  createdAt: string;
  ticketTitle: string;
  ticketStatus: string;
}

export default function RecentCommentsWidget() {
  const { t, i18n } = useTranslation();

  const { data: comments = [], isLoading } = useQuery<TicketComment[]>({
    queryKey: ["/api/dashboard/my-ticket-comments"],
    retry: false,
  });

  const getDateFnsLocale = () => {
    switch (i18n.language) {
      case "de":
        return de;
      case "es":
        return es;
      default:
        return enUS;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
      case "in_progress":
        return "default";
      case "completed":
      case "cancelled":
        return "secondary";
      default:
        return "secondary";
    }
  };

  const truncateText = (text: string, maxLength = 100) =>
    text.length <= maxLength ? text : `${text.substring(0, maxLength)}...`;

  return (
    <Card data-testid="widget-recent-comments">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{t("dashboard.recentComments")}</CardTitle>
          </div>
          <Link href="/tickets">
            <Button variant="ghost" size="sm" data-testid="button-view-all-comments">
              {t("common.viewAll")}
            </Button>
          </Link>
        </div>
        <CardDescription>{t("dashboard.recentCommentsDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : comments.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t("dashboard.noComments")}</div>
        ) : (
          <div className="space-y-3">
            {comments.slice(0, 5).map((comment) => (
              <Link key={comment.id} href={`/tickets?ticketId=${comment.ticketId}`}>
                <div className="flex flex-col gap-2 p-3 border rounded-md hover-elevate active-elevate-2 cursor-pointer">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{comment.ticketTitle}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {truncateText(comment.comment)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{comment.username}</span>
                      <Badge variant={getStatusColor(comment.ticketStatus)} className="text-xs">
                        {t(`tickets.statusValues.${comment.ticketStatus}`)}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(comment.createdAt), {
                        addSuffix: true,
                        locale: getDateFnsLocale(),
                      })}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
