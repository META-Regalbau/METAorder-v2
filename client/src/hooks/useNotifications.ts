import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import type { Notification } from "@shared/schema";

export function useNotifications() {
  const [unreadCount, setUnreadCount] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const [isConnected, setIsConnected] = useState(false);

  // Fetch notifications
  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    refetchOnWindowFocus: false,
  });

  // Fetch unread count
  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    refetchInterval: 60000, // Backup: refetch every minute
  });

  // Update unread count when data changes
  useEffect(() => {
    if (unreadData) {
      setUnreadCount(unreadData.count);
    }
  }, [unreadData]);

  // Connect to SSE stream using fetch-event-source (supports Authorization headers)
  const connectToStream = useCallback(async () => {
    // Don't create duplicate connections
    if (abortControllerRef.current) {
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      console.error("[Notifications] No auth token available");
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await fetchEventSource("/api/notifications/stream", {
        signal: abortController.signal,
        headers: {
          "Authorization": `Bearer ${token}`,
        },
        onopen: async (response) => {
          if (response.ok) {
            console.log("[Notifications] SSE connected");
            setIsConnected(true);
            // Clear any pending reconnect
            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current);
            }
          } else {
            throw new Error(`SSE connection failed: ${response.status}`);
          }
        },
        onmessage: (event) => {
          if (event.event === "notification") {
            try {
              const notification: Notification = JSON.parse(event.data);
              console.log("[Notifications] New notification:", notification);

              // Update unread count
              setUnreadCount((prev) => prev + 1);

              // Invalidate queries to refresh notification list
              queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
              queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
            } catch (error) {
              console.error("[Notifications] Error parsing notification:", error);
            }
          }
        },
        onerror: (error) => {
          console.error("[Notifications] SSE error:", error);
          setIsConnected(false);
          abortControllerRef.current = null;

          // Reconnect with exponential backoff
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log("[Notifications] Attempting to reconnect...");
            connectToStream();
          }, 5000);

          // Throw to trigger retry
          throw error;
        },
      });
    } catch (error) {
      console.error("[Notifications] Failed to connect to SSE:", error);
    }
  }, [queryClient]);

  // Initialize SSE connection
  useEffect(() => {
    connectToStream();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (abortControllerRef.current) {
        console.log("[Notifications] Closing SSE connection");
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [connectToStream]);

  return {
    notifications,
    unreadCount,
    isLoading,
    isConnected,
  };
}
