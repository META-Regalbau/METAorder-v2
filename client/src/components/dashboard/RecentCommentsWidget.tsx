import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
        return "b-default";
      case "completed":
        return "b-success";
      case "cancelled":
        return "b-outline";
      default:
        return "b-outline";
    }
  };

  const truncateText = (text: string, maxLength = 100) =>
    text.length <= maxLength ? text : `${text.substring(0, maxLength)}...`;

  return (
    <div className="mcard" data-testid="widget-recent-comments">
      <div className="mcard-head">
        <div>
          <div className="mcard-head-left">
            <MessageSquare className="h-5 w-5" />
            <h3 className="mcard-title">{t("dashboard.recentComments")}</h3>
          </div>
          <p className="mcard-desc">{t("dashboard.recentCommentsDescription")}</p>
        </div>
        <Link href="/tickets" className="mbtn ghost sm" data-testid="button-view-all-comments">
          {t("common.viewAll")}
        </Link>
      </div>
      <div className="mcard-body">
        {isLoading ? (
          <div className="mloading">{t("common.loading")}</div>
        ) : comments.length === 0 ? (
          <div className="mempty">{t("dashboard.noComments")}</div>
        ) : (
          <div className="mlist">
            {comments.slice(0, 5).map((comment) => (
              <Link key={comment.id} href={`/tickets?ticketId=${comment.ticketId}`} className="mrow link">
                <div className="mrow-main">
                  <div className="mrow-title">
                    <span className="truncate">{comment.ticketTitle}</span>
                  </div>
                  <p className="mrow-snippet">{truncateText(comment.comment)}</p>
                  <div className="mrow-badges">
                    <span className={`mbadge ${getStatusColor(comment.ticketStatus)}`}>
                      {t(`tickets.statusValues.${comment.ticketStatus}`)}
                    </span>
                  </div>
                  <div className="mrow-meta">
                    <span>{comment.username}</span>
                    <span>
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
      </div>
    </div>
  );
}
