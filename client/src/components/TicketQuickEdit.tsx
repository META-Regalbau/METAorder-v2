import { useMemo, useState } from "react";
import { ExternalLink, Filter, Loader2 } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { Ticket, User, Role } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRightSidebar } from "@/components/RightSidebarContext";
import TicketReplyComposer from "@/components/TicketReplyComposer";

type TicketQuickEditProps = {
  canManageTickets: boolean;
  canViewTickets: boolean;
};

type ScopeFilter = "mine" | "all" | "user";

const STATUS_OPTIONS = [
  "open",
  "in_progress",
  "waiting_for_customer",
  "waiting_for_internal",
  "resolved",
  "closed",
] as const;

const PRIORITY_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  urgent: "destructive",
  high: "default",
  normal: "secondary",
  low: "outline",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  open: "default",
  in_progress: "secondary",
  waiting_for_customer: "outline",
  waiting_for_internal: "outline",
  resolved: "default",
  closed: "secondary",
};

export default function TicketQuickEdit({ canManageTickets, canViewTickets }: TicketQuickEditProps) {
  const { t } = useTranslation();
  const { activeTicketId, setActiveTicketId } = useRightSidebar();
  const [scope, setScope] = useState<ScopeFilter>(canManageTickets ? "all" : "mine");
  const [selectedUserId, setSelectedUserId] = useState<string>("all");
  const [searchValue, setSearchValue] = useState("");

  const { data: currentUser } = useQuery<{ user: User & { permissions: Role["permissions"] } }>({
    queryKey: ["/api/auth/me"],
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/tickets/assignees"],
    enabled: canManageTickets,
  });

  const { data: ticketsData, isLoading: ticketsLoading } = useQuery<any>({
    queryKey: ["/api/tickets"],
  });

  const tickets: Ticket[] = useMemo(() => {
    if (Array.isArray(ticketsData)) {
      return ticketsData;
    }
    return ticketsData?.tickets || [];
  }, [ticketsData]);

  const filteredTickets = useMemo(() => {
    const userId = currentUser?.user?.id;
    return tickets.filter((ticket) => {
      const matchSearch =
        !searchValue ||
        ticket.ticketNumber.toLowerCase().includes(searchValue.toLowerCase()) ||
        ticket.title.toLowerCase().includes(searchValue.toLowerCase()) ||
        (ticket.description || "").toLowerCase().includes(searchValue.toLowerCase());

      const matchScope =
        scope === "all" ||
        (scope === "mine" && userId && (ticket.assignedToUserId === userId || ticket.createdByUserId === userId)) ||
        (scope === "user" && selectedUserId !== "all" && ticket.assignedToUserId === selectedUserId);

      return matchSearch && matchScope;
    });
  }, [tickets, searchValue, scope, selectedUserId, currentUser]);

  const activeTicket = filteredTickets.find((ticket) => ticket.id === activeTicketId) ||
    tickets.find((ticket) => ticket.id === activeTicketId) ||
    null;

  const getStatusLabel = (status?: string) => {
    const safeStatus = status || "open";
    return t(
      `tickets.status${safeStatus
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("")}`
    );
  };

  const getPriorityLabel = (priority?: string) => {
    const safePriority = priority || "normal";
    return t(
      `tickets.priority${safePriority.charAt(0).toUpperCase() + safePriority.slice(1)}`
    );
  };

  const updateTicketMutation = useMutation({
    mutationFn: async (data: Partial<Ticket>) => {
      if (!activeTicketId) throw new Error("No ticket selected");
      const response = await apiRequest("PATCH", `/api/tickets/${activeTicketId}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", activeTicketId] });
    },
  });

  if (!canViewTickets) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {t("tickets.quickEdit.noAccess")}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4">
      <div className="space-y-2">
        <Input
          placeholder={t("tickets.quickEdit.searchPlaceholder")}
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          data-testid="input-quick-ticket-search"
        />
        <div className="flex items-center gap-2">
          <Select value={scope} onValueChange={(value) => setScope(value as ScopeFilter)}>
            <SelectTrigger data-testid="select-quick-scope">
              <SelectValue placeholder={t("tickets.quickEdit.scope")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">{t("tickets.quickEdit.scopeMine")}</SelectItem>
              {canManageTickets && <SelectItem value="all">{t("tickets.quickEdit.scopeAll")}</SelectItem>}
              {canManageTickets && <SelectItem value="user">{t("tickets.quickEdit.scopeUser")}</SelectItem>}
            </SelectContent>
          </Select>
          {scope === "user" && canManageTickets && (
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger data-testid="select-quick-user">
                <SelectValue placeholder={t("tickets.quickEdit.selectUser")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("tickets.quickEdit.allUsers")}</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Filter className="h-3 w-3" />
          {t("tickets.quickEdit.results", { count: filteredTickets.length })}
        </div>
        {ticketsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </div>
        ) : (
          <div className="space-y-2 max-h-[220px] overflow-auto">
            {filteredTickets.slice(0, 15).map((ticket) => (
              <button
                key={ticket.id}
                onClick={() => setActiveTicketId(ticket.id)}
                className={`w-full text-left border rounded-md p-2 transition ${
                  ticket.id === activeTicketId
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
                data-testid={`quick-ticket-${ticket.id}`}
              >
                <div className="text-sm font-medium">{ticket.title}</div>
                <div className="text-xs text-muted-foreground">
                  #{ticket.ticketNumber}
                </div>
              </button>
            ))}
            {filteredTickets.length === 0 && (
              <div className="text-sm text-muted-foreground">
                {t("tickets.quickEdit.noTickets")}
              </div>
            )}
          </div>
        )}
      </div>

      {activeTicket ? (
        <Card>
          <CardContent className="p-3 space-y-3">
            <div className="space-y-1">
              <div className="text-sm font-semibold">{activeTicket.title}</div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={STATUS_VARIANTS[activeTicket.status] || "secondary"}>
                  {getStatusLabel(activeTicket.status)}
                </Badge>
                <Badge variant={PRIORITY_VARIANTS[activeTicket.priority] || "secondary"}>
                  {getPriorityLabel(activeTicket.priority)}
                </Badge>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                {t("tickets.quickEdit.statusChange")}
              </div>
              <Select
                value={activeTicket.status}
                onValueChange={(value) => updateTicketMutation.mutate({ status: value })}
                disabled={!canManageTickets || updateTicketMutation.isPending}
              >
                <SelectTrigger data-testid="select-quick-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((status) => (
                    <SelectItem key={status} value={status}>
                      {getStatusLabel(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <TicketReplyComposer
              ticketId={activeTicket.id}
              canManageTickets={canManageTickets}
              compact
            />

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.history.pushState({}, "", `/tickets?ticketId=${activeTicket.id}`);
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
              data-testid="button-open-ticket-detail"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              {t("tickets.quickEdit.openFull")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="text-sm text-muted-foreground">
          {t("tickets.quickEdit.selectTicketHint")}
        </div>
      )}
    </div>
  );
}
