import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Ticket, AlertCircle, Clock } from "lucide-react";
import { Link } from "wouter";
import type { Ticket as TicketType } from "@shared/schema";
import { format } from "date-fns";

export default function MyTicketsWidget() {
  const { t } = useTranslation();

  const { data: tickets = [], isLoading } = useQuery<TicketType[]>({
    queryKey: ["/api/dashboard/my-tickets"],
    retry: false,
  });

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "b-destructive";
      case "medium":
        return "b-default";
      case "low":
        return "b-outline";
      default:
        return "b-outline";
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

  return (
    <div className="mcard" data-testid="widget-my-tickets">
      <div className="mcard-head">
        <div>
          <div className="mcard-head-left">
            <Ticket className="h-5 w-5" />
            <h3 className="mcard-title">{t("dashboard.myTickets")}</h3>
          </div>
          <p className="mcard-desc">{t("dashboard.myTicketsDescription")}</p>
        </div>
        <Link href="/tickets" className="mbtn ghost sm" data-testid="button-view-all-tickets">
          {t("common.viewAll")}
        </Link>
      </div>
      <div className="mcard-body">
        {isLoading ? (
          <div className="mloading">{t("common.loading")}</div>
        ) : tickets.length === 0 ? (
          <div className="mempty">{t("dashboard.noTickets")}</div>
        ) : (
          <div className="mlist">
            {tickets.slice(0, 5).map((ticket) => (
              <Link key={ticket.id} href={`/tickets?ticketId=${ticket.id}`} className="mrow link">
                <div className="mrow-main">
                  <div className="mrow-title">
                    <span className="truncate">{ticket.title}</span>
                    {ticket.priority === "high" && (
                      <AlertCircle className="h-4 w-4 flex-shrink-0" style={{ color: "var(--meta-red)" }} />
                    )}
                  </div>
                  <div className="mrow-badges">
                    <span className={`mbadge ${getPriorityColor(ticket.priority)}`}>
                      {t(`tickets.priorityValues.${ticket.priority}`)}
                    </span>
                    <span className={`mbadge ${getStatusColor(ticket.status)}`}>
                      {t(`tickets.statusValues.${ticket.status}`)}
                    </span>
                    {ticket.dueDate && (
                      <div className="mrow-meta" style={{ marginTop: 0 }}>
                        <Clock className="h-3 w-3" />
                        {format(new Date(ticket.dueDate), "dd.MM.yyyy")}
                      </div>
                    )}
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
