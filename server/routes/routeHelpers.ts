// Gemeinsame Hilfsfunktionen der API-Routen (aus server/routes.ts ausgelagert).
import rateLimit from "express-rate-limit";
import { type Ticket } from "@shared/schema";
import { storage } from "../storage";
import { classifyTicketForRules } from "../tickets/ticketAi";
import type { Request } from "express";
import { getUploadsRoot } from "../uploadsRoot";
import path from "path";
import type { IStorage } from "../storage";
import { ShopwareClient } from "../shopware/shopware";

export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// Auto-assignment helper function
export async function assignTicketAutomatically(ticket: Ticket): Promise<string | null> {
  try {
    const rules = await storage.getActiveTicketAssignmentRules();
    
    if (rules.length === 0) {
      return null; // No auto-assignment rules
    }

    // OPTIMIZATION: Batch-load all data ONCE before the loop to eliminate N+1 queries
    const [allUsers, allRoles, allTickets] = await Promise.all([
      storage.getAllUsers(),
      storage.getAllRoles(),
      storage.getAllTickets(),
    ]);

    // Sort by priority (highest first)
    const sortedRules = rules.sort((a, b) => b.priority - a.priority);

    let aiResult: Awaited<ReturnType<typeof classifyTicketForRules>> | null = null;
    const ticketText = [ticket.title, ticket.description, ticket.emailSubject, ticket.emailFrom]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    for (const rule of sortedRules) {
      if (rule.assignmentType === 'round_robin') {
        // Round-robin: Find all users with manageTickets permission
        // Use pre-loaded data instead of fetching again
        const eligibleUsers = allUsers.filter(user => {
          if (user.roleId) {
            const userRole = allRoles.find(r => r.id === user.roleId);
            return userRole?.permissions?.manageTickets === true;
          }
          return false;
        });

        if (eligibleUsers.length === 0) continue;

        // Calculate round-robin using pre-loaded tickets
        const assignedCounts = new Map<string, number>();
        
        // Count assignments per user
        eligibleUsers.forEach(user => assignedCounts.set(user.id, 0));
        allTickets.forEach(t => {
          if (t.assignedToUserId && assignedCounts.has(t.assignedToUserId)) {
            assignedCounts.set(t.assignedToUserId, (assignedCounts.get(t.assignedToUserId) || 0) + 1);
          }
        });

        // Find user with least assignments
        let minAssignments = Infinity;
        let selectedUserId: string | null = null;
        
        eligibleUsers.forEach(user => {
          const count = assignedCounts.get(user.id) || 0;
          if (count < minAssignments) {
            minAssignments = count;
            selectedUserId = user.id;
          }
        });

        if (selectedUserId) {
          return selectedUserId;
        }
      } else if (rule.assignmentType === 'rule_based' && rule.conditions) {
        // Rule-based assignment
        try {
          const conditions = JSON.parse(rule.conditions);

          const needsAi =
            conditions.aiCategory ||
            conditions.aiPriority ||
            conditions.aiSentiment ||
            conditions.minConfidence ||
            conditions.keywords;

          if (needsAi && !aiResult) {
            aiResult = await classifyTicketForRules(storage, ticket);
          }
          
          // Check if all conditions match
          let conditionsMatch = true;
          
          if (conditions.priority && conditions.priority !== ticket.priority) {
            conditionsMatch = false;
          }
          if (conditions.category && conditions.category !== ticket.category) {
            conditionsMatch = false;
          }
          if (conditions.status && conditions.status !== ticket.status) {
            conditionsMatch = false;
          }
          
          if (conditionsMatch && aiResult) {
            if (conditions.aiCategory && conditions.aiCategory !== aiResult.category) {
              conditionsMatch = false;
            }
            if (conditions.aiPriority && conditions.aiPriority !== aiResult.priority) {
              conditionsMatch = false;
            }
            if (conditions.aiSentiment && conditions.aiSentiment !== aiResult.sentiment) {
              conditionsMatch = false;
            }
            if (conditions.minConfidence && aiResult.confidence < Number(conditions.minConfidence)) {
              conditionsMatch = false;
            }
            if (conditions.keywords) {
              const keywords = Array.isArray(conditions.keywords)
                ? conditions.keywords
                : String(conditions.keywords)
                    .split(",")
                    .map((value: string) => value.trim())
                    .filter(Boolean);
              if (keywords.length > 0 && !keywords.some((keyword: string) => ticketText.includes(keyword.toLowerCase()))) {
                conditionsMatch = false;
              }
            }
          }

          if (conditionsMatch) {
            // Assign to specified user or role
            if (rule.assignToUserId) {
              return rule.assignToUserId;
            } else if (rule.assignToRoleId) {
              // Use pre-loaded users instead of fetching again
              const userWithRole = allUsers.find(u => u.roleId === rule.assignToRoleId);
              if (userWithRole) {
                return userWithRole.id;
              }
            }
          }
        } catch (error) {
          console.error("Error parsing rule conditions:", error);
          continue;
        }
      }
    }

    return null; // No matching rule
  } catch (error) {
    console.error("Error in auto-assignment:", error);
    return null;
  }
}

export async function resolveUserRoleForChannels(user: any): Promise<{ salesChannelIds?: string[] | null; name?: string } | null> {
  if (user?.roleDetails) return user.roleDetails;
  if (!user?.roleId) return null;
  try {
    return (await storage.getRole(user.roleId)) ?? null;
  } catch (error) {
    console.error("Error fetching role for sales channel filter:", error);
    return null;
  }
}

export async function getSalesChannelFilter(req: Request): Promise<string[] | null> {
  const user = req.user as any;
  
  // SECURITY: User must be authenticated by this point
  if (!user || !user.id) {
    throw new Error("Unauthorized: No authenticated user found");
  }
  
  // SECURITY: Check if user is admin (true admin, not just lacking channel assignments)
  const isAdmin = 
    user?.roleDetails?.name === 'Administrator' || 
    user?.role === 'admin';
  
  // Admin users have full access (no filtering)
  if (isAdmin) {
    return null; // null = see all channels
  }
  
  const role = await resolveUserRoleForChannels(user);
  const channelIds = new Set<string>();
  
  // User-level channel restriction (null/empty = inherit from role)
  if (Array.isArray(user.salesChannelIds) && user.salesChannelIds.length > 0) {
    user.salesChannelIds.forEach((id: string) => channelIds.add(id));
  }
  
  if (role && Array.isArray(role.salesChannelIds) && role.salesChannelIds.length > 0) {
    role.salesChannelIds.forEach((id: string) => channelIds.add(id));
  }

  const userHasOwnChannels =
    Array.isArray(user.salesChannelIds) && user.salesChannelIds.length > 0;

  // Rolle ohne Kanalliste = alle Shopware-Verkaufskanäle (Standard z. B. Employee)
  if (!userHasOwnChannels && role && role.salesChannelIds == null) {
    return null;
  }
  
  if (channelIds.size === 0) {
    return [];
  }
  
  return Array.from(channelIds);
}

export const DEFAULT_TICKET_SLA_SETTINGS = {
  lowDays: 7,
  normalDays: 3,
  highDays: 2,
  urgentDays: 1,
};

export async function getTicketSlaSettings() {
  const stored = (await storage.getSetting("ticket_sla_settings")) || {};
  return {
    ...DEFAULT_TICKET_SLA_SETTINGS,
    ...stored,
  };
}

export const sanitizeFilename = (value: string) =>
  value
    .replace(/[\\/]+/g, "_")
    .replace(/\.\.+/g, ".")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_");

export const resolveAttachmentPath = (filePath: string) => {
  const root = getUploadsRoot();
  const normalized = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath);
  if (!normalized.startsWith(root + path.sep)) {
    throw new Error("Invalid attachment path");
  }
  return normalized;
};

// Helper function: Filter tickets by sales channel (indirect via orderId)
// SECURITY: Tickets are filtered indirectly through their linked order's salesChannelId
// Logic: 
//   - Tickets WITH orderId: Filter by order's salesChannelId
//   - Tickets WITHOUT orderId: Only visible to admin/creator/assignee (NOT universally readable)
//   - Admin (allowedChannelIds = null): Allow all
export async function filterTicketsBySalesChannels(
  tickets: any[],
  allowedChannelIds: string[] | null,
  storage: IStorage,
  currentUserId?: string // Optional: Used to check creator/assignee access for standalone tickets
): Promise<any[]> {
  // Admin (null) → return all tickets
  if (allowedChannelIds === null) {
    return tickets;
  }
  
  // SECURITY: Empty array means NO channel access (not admin)
  // Return only standalone tickets that user created/is assigned to
  if (allowedChannelIds.length === 0) {
    return tickets.filter(ticket => {
      if (!ticket.orderId) {
        // Standalone ticket: only visible if user is creator or assignee
        if (!currentUserId) return false;
        return ticket.createdByUserId === currentUserId || ticket.assignedToUserId === currentUserId;
      }
      return false; // Order-linked tickets not accessible (no channel access)
    });
  }
  
  // Get unique orderIds from tickets (only those with orderId)
  const uniqueOrderIds = Array.from(new Set(tickets.filter(t => t.orderId).map(t => t.orderId!)));
  
  // If no tickets have orderIds, filter standalone tickets with creator/assignee check
  if (uniqueOrderIds.length === 0) {
    return tickets.filter(ticket => {
      if (!ticket.orderId) {
        // Standalone ticket: only visible if user is creator or assignee
        if (!currentUserId) return false;
        return ticket.createdByUserId === currentUserId || ticket.assignedToUserId === currentUserId;
      }
      return false;
    });
  }
  
  // Fetch orders to get their salesChannelIds
  const settings = await storage.getShopwareSettings();
  let ordersBySalesChannel: Map<string, string> = new Map(); // orderId -> salesChannelId
  
  if (settings && uniqueOrderIds.length > 0) {
    try {
      const client = new ShopwareClient(settings);
      const ordersMap = await client.fetchOrdersByIds(uniqueOrderIds);
      
      // Convert to salesChannelId map
      ordersMap.forEach((order, orderId) => {
        ordersBySalesChannel.set(orderId, order.salesChannelId);
      });
    } catch (error) {
      console.error("[Security] Error fetching orders for ticket filtering:", error);
      // SECURITY: If we can't fetch orders, return only standalone tickets with creator/assignee check
      return tickets.filter(ticket => {
        if (!ticket.orderId) {
          // Standalone ticket: only visible if user is creator or assignee
          if (!currentUserId) return false;
          return ticket.createdByUserId === currentUserId || ticket.assignedToUserId === currentUserId;
        }
        return false; // Order-linked tickets not accessible (fail-safe)
      });
    }
  }
  
  // Filter tickets:
  // - Tickets WITHOUT orderId: Only visible to admin/creator/assignee (SECURITY FIX)
  // - Tickets WITH orderId: Only if order's salesChannelId matches allowedChannelIds
  return tickets.filter(ticket => {
    // SECURITY: Standalone tickets (no orderId) are NOT universally readable
    // Only visible to: admin (allowedChannelIds=null), creator, or assignee
    if (!ticket.orderId) {
      // If no currentUserId provided, block standalone tickets for safety
      if (!currentUserId) {
        return false;
      }
      // Allow if user is creator or assignee
      return ticket.createdByUserId === currentUserId || ticket.assignedToUserId === currentUserId;
    }
    
    // Order-linked tickets: Check if order's sales channel matches user's allowed channels
    const orderSalesChannel = ordersBySalesChannel.get(ticket.orderId);
    return orderSalesChannel && allowedChannelIds.includes(orderSalesChannel);
  });
}
