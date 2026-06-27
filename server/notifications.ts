import webpush from "web-push";
import type { IStorage } from "./storage";

type PushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

function getVapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "mailto:support@example.com";
  if (!publicKey || !privateKey) {
    return null;
  }
  return { publicKey, privateKey, subject };
}

export function getVapidPublicKey(): string | null {
  const config = getVapidConfig();
  return config ? config.publicKey : null;
}

async function sendPush(subscription: PushSubscription, payload: any) {
  const config = getVapidConfig();
  if (!config) {
    throw new Error("VAPID keys not configured");
  }
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  await webpush.sendNotification(subscription as any, JSON.stringify(payload));
}

async function userCanViewTickets(storage: IStorage, user: any): Promise<boolean> {
  if (user.role === "admin") return true;
  if (user.roleId) {
    const role = await storage.getRole(user.roleId);
    return Boolean(role?.permissions?.viewTickets);
  }
  return false;
}

export async function notifyNewTicket(
  storage: IStorage,
  ticket: { id: string; ticketNumber: string; title: string; assignedToUserId?: string | null }
) {
  const users = await storage.getAllUsers();
  const payload = {
    title: "Neues Ticket",
    body: `${ticket.ticketNumber} · ${ticket.title}`,
    data: {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
    },
  };

  const candidates = ticket.assignedToUserId
    ? users.filter((user) => user.id === ticket.assignedToUserId)
    : users;

  for (const user of candidates) {
    if (!user.pushEnabled || !user.pushSubscription) continue;
    if (!ticket.assignedToUserId) {
      const canView = await userCanViewTickets(storage, user);
      if (!canView) continue;
    }
    try {
      await sendPush(user.pushSubscription as PushSubscription, payload);
    } catch (error) {
      console.error("[Notifications] Failed sending push:", error);
    }
  }
}
