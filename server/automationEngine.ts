import type { IStorage } from "./storage";
import type { AutomationRule, Order, Ticket } from "@shared/schema";
import { getOpenAIClientFromSettings } from "./openaiClient";

export interface AutomationContext {
  trigger: string;
  data: {
    order?: Order;
    ticket?: Ticket;
    oldStatus?: string;
    newStatus?: string;
    [key: string]: any;
  };
}

export interface AutomationAction {
  type: "create_ticket" | "update_order_status" | "send_notification" | "assign_ticket" | "update_ticket_priority" | "send_email" | "run_ai_analysis";
  params: Record<string, any>;
}

export class AutomationEngine {
  constructor(private storage: IStorage) {}

  /**
   * Execute automation rules for a given trigger
   */
  async executeTrigger(triggerType: string, context: AutomationContext): Promise<void> {
    try {
      console.log(`[AutomationEngine] Executing trigger: ${triggerType}`);
      
      // Get all active automation rules for this trigger
      const rules = await this.storage.getActiveAutomationRules();
      const activeRulesForTrigger = rules.filter((rule) => rule.triggerType === triggerType);

      console.log(`[AutomationEngine] Found ${activeRulesForTrigger.length} active rules for trigger ${triggerType}`);

      // Sort by priority (highest first)
      const sortedRules = activeRulesForTrigger.sort((a, b) => b.priority - a.priority);

      // Execute each matching rule
      for (const rule of sortedRules) {
        try {
          await this.executeRule(rule, context);
        } catch (error) {
          console.error(`[AutomationEngine] Error executing rule ${rule.id}:`, error);
          // Continue with other rules even if one fails
        }
      }
    } catch (error) {
      console.error(`[AutomationEngine] Error in executeTrigger:`, error);
    }
  }

  /**
   * Execute a single automation rule
   */
  private async executeRule(rule: AutomationRule, context: AutomationContext): Promise<void> {
    console.log(`[AutomationEngine] Evaluating rule: ${rule.name}`);

    // Check if conditions are met
    const conditionsMet = this.evaluateConditions(rule, context);
    
    if (!conditionsMet) {
      console.log(`[AutomationEngine] Conditions not met for rule: ${rule.name}`);
      return;
    }

    console.log(`[AutomationEngine] Conditions met! Executing actions for rule: ${rule.name}`);

    // Parse and execute actions
    const actions = this.parseActions(rule.actions);
    let allActionsSucceeded = true;
    
    for (const action of actions) {
      try {
        await this.executeAction(action, context);
        
        // Log successful execution
        await this.storage.createAutomationExecution({
          ruleId: rule.id,
          status: "success",
          result: {
            trigger: context.trigger,
            action: action.type,
            context: context.data,
          },
          error: null,
        });
      } catch (error: any) {
        console.error(`[AutomationEngine] Error executing action:`, error);
        allActionsSucceeded = false;
        
        // Log failed execution
        await this.storage.createAutomationExecution({
          ruleId: rule.id,
          status: "failure",
          result: {
            trigger: context.trigger,
            action: action.type,
            context: context.data,
          },
          error: error.message,
        });
      }
    }
    
    // Increment execution count and update last executed timestamp
    await this.storage.incrementRuleExecutionCount(rule.id);
  }

  /**
   * Evaluate conditions for a rule
   */
  private evaluateConditions(rule: AutomationRule, context: AutomationContext): boolean {
    // If no conditions, always execute
    if (!rule.conditions) {
      return true;
    }

    try {
      const conditions = JSON.parse(rule.conditions);
      
      // Evaluate each condition
      for (const [key, value] of Object.entries(conditions)) {
        if (!this.evaluateCondition(key, value, context)) {
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error(`[AutomationEngine] Error parsing conditions:`, error);
      return false;
    }
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(key: string, value: any, context: AutomationContext): boolean {
    const { data } = context;

    switch (key) {
      case "orderStatus":
        return data.order?.status === value || data.newStatus === value;
      
      case "paymentStatus":
        return data.order?.paymentStatus === value;
      
      case "delayedDays":
        if (!data.order?.orderDate) return false;
        const orderDate = new Date(data.order.orderDate);
        const daysDiff = Math.floor((Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
        return daysDiff >= value;
      
      case "ticketPriority":
        return data.ticket?.priority === value;
      
      case "ticketCategory":
        return data.ticket?.category === value;
      
      case "ticketStatus":
        return data.ticket?.status === value;
      
      default:
        console.warn(`[AutomationEngine] Unknown condition key: ${key}`);
        return false;
    }
  }

  /**
   * Parse actions from JSON string
   */
  private parseActions(actionsJson: string): AutomationAction[] {
    try {
      const parsed = JSON.parse(actionsJson);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      console.error(`[AutomationEngine] Error parsing actions:`, error);
      return [];
    }
  }

  /**
   * Execute a single action
   */
  private async executeAction(action: AutomationAction, context: AutomationContext): Promise<void> {
    console.log(`[AutomationEngine] Executing action: ${action.type}`);

    switch (action.type) {
      case "create_ticket":
        await this.createTicketAction(action.params, context);
        break;
      
      case "update_order_status":
        await this.updateOrderStatusAction(action.params, context);
        break;
      
      case "send_notification":
        await this.sendNotificationAction(action.params, context);
        break;
      
      case "assign_ticket":
        await this.assignTicketAction(action.params, context);
        break;
      
      case "update_ticket_priority":
        await this.updateTicketPriorityAction(action.params, context);
        break;
      
      case "send_email":
        await this.sendEmailAction(action.params, context);
        break;
      
      case "run_ai_analysis":
        await this.runAIAnalysisAction(action.params, context);
        break;
      
      default:
        console.warn(`[AutomationEngine] Unknown action type: ${action.type}`);
    }
  }

  /**
   * Create a ticket
   */
  private async createTicketAction(params: Record<string, any>, context: AutomationContext): Promise<void> {
    const { order } = context.data;
    
    const ticket = await this.storage.createTicket({
      title: params.title || "Automated Ticket",
      description: params.description || "",
      status: params.status || "open",
      priority: params.priority || "medium",
      category: params.category || "general",
      tags: params.tags || null,
      orderId: order?.id || null,
      createdByUserId: null, // System-generated
      assignedToUserId: null,
    });

    console.log(`[AutomationEngine] Created ticket: ${ticket.id}`);
  }

  /**
   * Update order status
   */
  private async updateOrderStatusAction(params: Record<string, any>, context: AutomationContext): Promise<void> {
    const { order } = context.data;
    
    if (!order) {
      throw new Error("No order in context");
    }

    // Note: This would need Shopware integration to actually update the order
    console.log(`[AutomationEngine] Would update order ${order.id} status to: ${params.status}`);
    // TODO: Implement Shopware order status update
  }

  /**
   * Send a notification
   */
  private async sendNotificationAction(params: Record<string, any>, context: AutomationContext): Promise<void> {
    // This could be extended to send email/SMS notifications
    console.log(`[AutomationEngine] Would send notification: ${params.message}`);
    
    // For now, just create an in-app notification if there's a user
    if (params.userId) {
      await this.storage.createNotification({
        userId: params.userId,
        type: "ticket_status_changed",
        title: params.title || "Automation Notification",
        message: params.message || "",
        ticketId: params.ticketId || null,
        ticketNumber: params.ticketNumber || null,
        read: 0,
      });
    }
  }

  /**
   * Assign a ticket to a user
   */
  private async assignTicketAction(params: Record<string, any>, context: AutomationContext): Promise<void> {
    const { ticket } = context.data;
    
    if (!ticket) {
      throw new Error("No ticket in context");
    }

    await this.storage.updateTicket(ticket.id, {
      assignedToUserId: params.userId,
    });

    console.log(`[AutomationEngine] Assigned ticket ${ticket.id} to user: ${params.userId}`);
  }

  /**
   * Update ticket priority
   */
  private async updateTicketPriorityAction(params: Record<string, any>, context: AutomationContext): Promise<void> {
    const { ticket } = context.data;
    
    if (!ticket) {
      throw new Error("No ticket in context");
    }

    await this.storage.updateTicket(ticket.id, {
      priority: params.priority,
    });

    console.log(`[AutomationEngine] Updated ticket ${ticket.id} priority to: ${params.priority}`);
  }

  /**
   * Send email notification
   */
  private async sendEmailAction(params: Record<string, any>, context: AutomationContext): Promise<void> {
    // Email service not configured - would need EMAIL_API_KEY and EMAIL_FROM_ADDRESS
    console.log(`[AutomationEngine] Email action (not configured): to=${params.to}, subject=${params.subject}`);
    console.warn(`[AutomationEngine] Email notifications require external email service configuration`);
    
    // TODO: Implement email sending using Resend/SendGrid when credentials are available
  }

  /**
   * Run AI analysis on ticket
   */
  private async runAIAnalysisAction(params: Record<string, any>, context: AutomationContext): Promise<void> {
    const { ticket } = context.data;
    
    if (!ticket) {
      throw new Error("No ticket in context");
    }

    try {
      // Get OpenAI client
      const openaiConfig = await getOpenAIClientFromSettings(
        async (key: string) => {
          const setting = await this.storage.getSetting(key);
          return setting?.value;
        }
      );

      if (!openaiConfig) {
        console.warn(`[AutomationEngine] AI analysis skipped - OpenAI not configured`);
        return;
      }

      const { client } = openaiConfig;

      // Run sentiment analysis if requested
      if (params.analyzeSentiment) {
        const sentimentResponse = await Promise.race([
          client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "You are a sentiment analysis assistant. Analyze the sentiment of customer support tickets and respond with ONLY one word: positive, neutral, or negative.",
              },
              {
                role: "user",
                content: `Title: ${ticket.title}\n\nDescription: ${ticket.description}`,
              },
            ],
            temperature: 0.3,
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('TIMEOUT')), 30000)
          )
        ]) as any;

        const sentiment = sentimentResponse.choices[0]?.message?.content?.toLowerCase().trim();
        console.log(`[AutomationEngine] AI Sentiment Analysis for ticket ${ticket.id}: ${sentiment}`);

        // Auto-prioritize based on sentiment
        if (sentiment === "negative" && ticket.priority === "low") {
          await this.storage.updateTicket(ticket.id, {
            priority: "high",
          });
          console.log(`[AutomationEngine] Auto-escalated ticket ${ticket.id} to high priority (negative sentiment)`);
        }
      }

      // Run category suggestion if requested
      if (params.suggestCategory) {
        const categoryResponse = await Promise.race([
          client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "You are a customer support ticket categorization assistant. Suggest the most appropriate category from: technical, billing, shipping, returns, general, product_inquiry. Respond with ONLY the category name.",
              },
              {
                role: "user",
                content: `Title: ${ticket.title}\n\nDescription: ${ticket.description}`,
              },
            ],
            temperature: 0.3,
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('TIMEOUT')), 30000)
          )
        ]) as any;

        const suggestedCategory = categoryResponse.choices[0]?.message?.content?.toLowerCase().trim();
        console.log(`[AutomationEngine] AI Category Suggestion for ticket ${ticket.id}: ${suggestedCategory}`);

        // Auto-categorize if ticket has no category
        if (!ticket.category || ticket.category === "general") {
          // Map AI suggestion to valid category
          const validCategories = ["general", "order_issue", "product_inquiry", "technical_support", "complaint", "feature_request", "other"];
          const mappedCategory = validCategories.includes(suggestedCategory || "") ? suggestedCategory : "general";
          
          await this.storage.updateTicket(ticket.id, {
            category: mappedCategory as any,
          });
          console.log(`[AutomationEngine] Auto-categorized ticket ${ticket.id} as: ${mappedCategory}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[AutomationEngine] Error in AI analysis:`, errorMessage);
      
      // Log specific error types for debugging but don't fail the automation
      if (errorMessage.includes('TIMEOUT')) {
        console.warn(`[AutomationEngine] AI analysis timed out for ticket ${ticket.id}`);
      } else if (errorMessage.includes('rate_limit') || errorMessage.includes('429')) {
        console.warn(`[AutomationEngine] Rate limit exceeded for ticket ${ticket.id}`);
      } else if (errorMessage.includes('authentication') || errorMessage.includes('401') || 
                 errorMessage.includes('api_key') || errorMessage.includes('Incorrect API key')) {
        console.warn(`[AutomationEngine] Authentication failed for ticket ${ticket.id}`);
      }
      
      // Don't throw - allow automation to continue even if AI analysis fails
      console.log(`[AutomationEngine] Continuing automation despite AI analysis error`);
    }
  }

  /**
   * Check for delayed orders and create tickets (scheduled job)
   */
  async checkDelayedOrders(): Promise<void> {
    try {
      console.log(`[AutomationEngine] Running scheduled check for delayed orders`);
      
      // This would be called by a cron job or scheduler
      // For now, we just trigger the scheduled automation rules
      await this.executeTrigger("scheduled", {
        trigger: "scheduled",
        data: {},
      });
    } catch (error) {
      console.error(`[AutomationEngine] Error in checkDelayedOrders:`, error);
    }
  }
}
