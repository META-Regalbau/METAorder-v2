import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
        return "destructive";
      case "medium":
        return "default";
      case "low":
        return "secondary";
      default:
        return "secondary";
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

  return (
    <Card data-testid="widget-my-tickets">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{t("dashboard.myTickets")}</CardTitle>
          </div>
          <Link href="/tickets">
            <Button variant="ghost" size="sm" data-testid="button-view-all-tickets">
              {t("common.viewAll")}
            </Button>
          </Link>
        </div>
        <CardDescription>{t("dashboard.myTicketsDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : tickets.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t("dashboard.noTickets")}</div>
        ) : (
          <div className="space-y-3">
            {tickets.slice(0, 5).map((ticket) => (
              <Link key={ticket.id} href={`/tickets?ticketId=${ticket.id}`}>
                <div className="flex items-start justify-between p-3 border rounded-md hover-elevate active-elevate-2 cursor-pointer">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{ticket.title}</span>
                      {ticket.priority === "high" && (
                        <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={getPriorityColor(ticket.priority)} className="text-xs">
                        {t(`tickets.priorityValues.${ticket.priority}`)}
                      </Badge>
                      <Badge variant={getStatusColor(ticket.status)} className="text-xs">
                        {t(`tickets.statusValues.${ticket.status}`)}
                      </Badge>
                      {ticket.dueDate && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {format(new Date(ticket.dueDate), "dd.MM.yyyy")}
                        </div>
                      )}
                    </div>
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
