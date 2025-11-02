import { Bell, Ticket, FileEdit, MessageSquare, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useNotifications } from "@/hooks/useNotifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import { de, enUS, es } from "date-fns/locale";
import type { Notification } from "@shared/schema";
import { Link } from "wouter";

export function NotificationBell() {
  const { notifications, unreadCount, isLoading } = useNotifications();
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const locale = i18n.language === "de" ? de : i18n.language === "es" ? es : enUS;

  // Mark notification as read
  const markAsReadMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("PATCH", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  // Mark all as read
  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/notifications/mark-all-read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const handleNotificationClick = (notification: Notification) => {
    if (notification.read === 0) {
      markAsReadMutation.mutate(notification.id);
    }
  };

  const getNotificationIcon = (type: string) => {
    const iconClass = "h-5 w-5";
    switch (type) {
      case "ticket_assigned":
        return <Ticket className={iconClass} />;
      case "ticket_updated":
        return <FileEdit className={iconClass} />;
      case "comment_added":
        return <MessageSquare className={iconClass} />;
      case "due_date_warning":
        return <Clock className={iconClass} />;
      case "ticket_status_changed":
        return <RefreshCw className={iconClass} />;
      default:
        return <Bell className={iconClass} />;
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          data-testid="button-notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
              data-testid="badge-unread-count"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end" data-testid="popover-notifications">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold" data-testid="text-notifications-title">
            {t("notifications.title")}
          </h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllAsReadMutation.mutate()}
              disabled={markAllAsReadMutation.isPending}
              data-testid="button-mark-all-read"
            >
              {t("notifications.markAllRead")}
            </Button>
          )}
        </div>

        <ScrollArea className="h-[400px]">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground" data-testid="text-loading">
              {t("common.loading")}
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center" data-testid="text-no-notifications">
              <Bell className="h-12 w-12 mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {t("notifications.noNotifications")}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => (
                <Link
                  key={notification.id}
                  href={notification.ticketId ? `/tickets?ticketId=${notification.ticketId}` : "#"}
                >
                  <button
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full text-left p-4 hover-elevate active-elevate-2 transition-colors ${
                      notification.read === 0 ? "bg-accent/30" : ""
                    }`}
                    data-testid={`notification-item-${notification.id}`}
                  >
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 mt-1 text-muted-foreground">
                        {getNotificationIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className={`text-sm font-medium ${notification.read === 0 ? "font-semibold" : ""}`}>
                            {notification.title}
                          </p>
                          {notification.read === 0 && (
                            <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-1">
                          {notification.message}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(notification.createdAt), {
                            addSuffix: true,
                            locale,
                          })}
                        </p>
                      </div>
                    </div>
                  </button>
                </Link>
              ))}
            </div>
          )}
        </ScrollArea>

        {notifications.length > 0 && (
          <>
            <Separator />
            <div className="p-2">
              <Link href="/notifications">
                <Button
                  variant="ghost"
                  className="w-full"
                  size="sm"
                  data-testid="link-view-all"
                >
                  {t("notifications.viewAll")}
                </Button>
              </Link>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
