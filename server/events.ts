import { EventEmitter } from "events";
import type { Notification } from "@shared/schema";

export interface NotificationEvent {
  notification: Notification;
}

class NotificationEventEmitter extends EventEmitter {
  emitNotificationCreated(notification: Notification) {
    this.emit("notification:created", { notification });
  }

  onNotificationCreated(listener: (event: NotificationEvent) => void) {
    this.on("notification:created", listener);
  }

  removeNotificationCreatedListener(listener: (event: NotificationEvent) => void) {
    this.removeListener("notification:created", listener);
  }
}

export const notificationEvents = new NotificationEventEmitter();
