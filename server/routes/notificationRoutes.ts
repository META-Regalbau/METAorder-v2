// Benachrichtigungen: Liste, Ungelesen-Zaehler, Push-Einstellungen, SSE-Stream, gelesen markieren.
import { requireAuth } from "../auth/auth";
import type { Request, Response, Express } from "express";
import { storage } from "../storage";
import { getVapidPublicKey } from "../lib/notifications";
import { z } from "zod";
import { notificationEvents } from "../lib/events";
import { logger } from "../lib/logger";

const log = logger.child({ component: "routes/notificationRoutes" });

export function registerNotificationRoutes(app: Express): void {
  // ============================================
  // NOTIFICATIONS
  // ============================================

  // Get user's notifications
  app.get("/api/notifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any).id;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      
      const notifications = await storage.getNotificationsByUserId(userId, limit);
      res.json(notifications);
    } catch (error) {
      log.error({ err: error }, "Error fetching notifications:");
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  // Get unread notification count
  app.get("/api/notifications/unread-count", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any).id;
      const count = await storage.getUnreadNotificationCount(userId);
      res.json({ count });
    } catch (error) {
      log.error({ err: error }, "Error fetching unread count:");
      res.status(500).json({ error: "Failed to fetch unread count" });
    }
  });

  // Push notification settings (per user)
  app.get("/api/notifications/push-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any).id;
      const user = await storage.getUser(userId);
      const publicKey = getVapidPublicKey();
      res.json({
        enabled: Boolean(user?.pushEnabled),
        subscription: user?.pushSubscription || null,
        publicKey,
      });
    } catch (error) {
      log.error({ err: error }, "Error fetching push settings:");
      res.status(500).json({ error: "Failed to fetch push settings" });
    }
  });

  app.post("/api/notifications/push-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any).id;
      const schema = z.object({
        enabled: z.boolean(),
        subscription: z.any().optional(),
      });
      const { enabled, subscription } = schema.parse(req.body);
      if (enabled && !subscription) {
        return res.status(400).json({ error: "Subscription required when enabling push" });
      }
      const updated = await storage.updateUser(userId, {
        pushEnabled: enabled,
        pushSubscription: enabled ? subscription : null,
      });
      res.json({ enabled: Boolean(updated?.pushEnabled) });
    } catch (error: any) {
      log.error({ err: error }, "Error saving push settings:");
      res.status(500).json({ error: error.message || "Failed to save push settings" });
    }
  });

  app.delete("/api/notifications/push-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any).id;
      await storage.updateUser(userId, { pushEnabled: false, pushSubscription: null });
      res.json({ enabled: false });
    } catch (error) {
      log.error({ err: error }, "Error disabling push settings:");
      res.status(500).json({ error: "Failed to disable push settings" });
    }
  });

  // Server-Sent Events stream for real-time notifications
  app.get("/api/notifications/stream", async (req: Request, res: Response) => {
    // Extract JWT from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    // Verify JWT token
    let userId: string;
    try {
      const jwt = await import("../auth/jwt");
      const decoded = jwt.verifyToken(token);
      if (!decoded) {
        return res.status(401).json({ error: "Invalid token" });
      }
      userId = decoded.userId;
    } catch (error) {
      return res.status(401).json({ error: "Invalid token" });
    }
    
    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    
    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    
    // Create notification listener
    const notificationListener = async ({ notification }: { notification: any }) => {
      // Only send notifications for this user
      if (notification.userId === userId) {
        res.write(`event: notification\n`);
        res.write(`data: ${JSON.stringify(notification)}\n\n`);
      }
    };
    
    // Register listener
    notificationEvents.onNotificationCreated(notificationListener);
    
    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeatInterval = setInterval(() => {
      res.write(`:heartbeat\n\n`);
    }, 30000);
    
    // Cleanup on connection close
    req.on("close", () => {
      clearInterval(heartbeatInterval);
      notificationEvents.removeNotificationCreatedListener(notificationListener);
    });
  });

  // Mark notification as read
  app.patch("/api/notifications/:id/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = (req.user as any).id;
      
      // Verify notification belongs to user
      const notification = await storage.getNotificationsByUserId(userId);
      const found = notification.find(n => n.id === id);
      
      if (!found) {
        return res.status(404).json({ error: "Notification not found" });
      }
      
      const updated = await storage.markNotificationAsRead(id);
      res.json(updated);
    } catch (error) {
      log.error({ err: error }, "Error marking notification as read:");
      res.status(500).json({ error: "Failed to mark notification as read" });
    }
  });

  // Mark all notifications as read
  app.post("/api/notifications/mark-all-read", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any).id;
      const count = await storage.markAllNotificationsAsRead(userId);
      res.json({ count });
    } catch (error) {
      log.error({ err: error }, "Error marking all notifications as read:");
      res.status(500).json({ error: "Failed to mark all notifications as read" });
    }
  });
}
