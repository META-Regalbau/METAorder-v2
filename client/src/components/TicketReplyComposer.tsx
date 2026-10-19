import { AlertTriangle, Bot, Loader2, RefreshCw, Send, Sparkles, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { replyPlaceholders } from "@shared/emailIntake";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

/** KI-Antwortentwurf zu einer Kundenanfrage aus dem E-Mail-Eingang (GET /api/tickets/:id/reply-draft) */
type ReplyDraft = {
  kind: "order_status" | "complaint" | "general" | "offer_request";
  status: string;
  mailbox: string | null;
  customerEmail: string;
  draft: string | null;
  draftError: string | null;
  sentText: string | null;
  sentAt: string | null;
  lastError: string | null;
  attempts: number;
  order: { orderNumber: string; status: string; shipped: boolean; trackingCodes: string[] } | null;
  orderNumbers: string[];
  orderNote: string | null;
  reason: string | null;
};

interface Template {
  id: string;
  title: string;
  category?: string | null;
  content: string;
}

type TicketReplyComposerProps = {
  ticketId: string;
  canManageTickets: boolean;
  compact?: boolean;
  onCommentAdded?: () => void;
};

export default function TicketReplyComposer({
  ticketId,
  canManageTickets,
  compact = false,
  onCommentAdded,
}: TicketReplyComposerProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [commentText, setCommentText] = useState("");
  const [isInternalComment, setIsInternalComment] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["/api/templates"],
    retry: false,
  });

  const { data: favoritesData } = useQuery<{ favorites: string[] }>({
    queryKey: ["/api/templates/favorites"],
    retry: false,
  });

  const favorites = favoritesData?.favorites || [];

  const { data: aiSettings } = useQuery<{ enabled: boolean; hasApiKey: boolean }>({
    queryKey: ["/api/settings/ai"],
    retry: false,
  });

  const { data: outboundStatus } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/email/outbound-status"],
    retry: false,
  });

  const { data: ticket } = useQuery<{ customerEmail?: string | null; emailFrom?: string | null }>({
    queryKey: ["/api/tickets", ticketId],
    retry: false,
  });

  // Kundenanfrage aus dem E-Mail-Eingang: Entwurf vorbelegen. Verschickt wird dort nicht über den
  // Mailversand von METAorder, sondern über n8n aus dem Postfach der Mail (Freigeben & senden).
  const { data: replyDraft } = useQuery<ReplyDraft | null>({
    queryKey: ["/api/tickets", ticketId, "reply-draft"],
    queryFn: async () => {
      const res = await fetch(`/api/tickets/${ticketId}/reply-draft`, { credentials: "include", cache: "no-store" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    retry: false,
  });
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !replyDraft) return;
    const text = replyDraft.status === "failed" ? replyDraft.sentText : replyDraft.status === "draft" ? replyDraft.draft : null;
    if (!text) return;
    prefilled.current = true;
    setCommentText((current) => (current.trim() ? current : text));
  }, [replyDraft]);

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/tickets/${ticketId}/reply-draft/regenerate`, {});
      return (await response.json()) as ReplyDraft;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/tickets", ticketId, "reply-draft"], data);
      if (data.draft) setCommentText(data.draft);
      toast({ title: t("tickets.replyDraft.regenerated") });
    },
    onError: (error: Error) => {
      toast({ title: t("tickets.replyDraft.regenerateFailed"), description: error.message, variant: "destructive" });
    },
  });

  const sendReplyMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/tickets/${ticketId}/reply-draft/send`, { text: commentText });
      return (await response.json()) as ReplyDraft;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/tickets", ticketId, "reply-draft"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", ticketId, "comments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", ticketId, "activity"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", ticketId] });
      setCommentText("");
      toast({ title: t("tickets.replyDraft.queued") });
      onCommentAdded?.();
    },
    onError: (error: Error) => {
      toast({ title: t("tickets.replyDraft.sendFailed"), description: error.message, variant: "destructive" });
    },
  });

  const isIntakeReply = Boolean(replyDraft);
  const replySendable = replyDraft?.status === "draft" || replyDraft?.status === "failed";
  const placeholders = isIntakeReply && !isInternalComment ? replyPlaceholders(commentText) : [];
  const canSendEmail = !isIntakeReply && Boolean(outboundStatus?.enabled && (ticket?.customerEmail || ticket?.emailFrom));

  const improveTextMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest("POST", "/api/ai/improve-text", { text });
      return response.json();
    },
    onSuccess: (data) => {
      setCommentText(data.improvedText);
      toast({
        title: t("ai.textImproved"),
        description: t("ai.textImprovedDesc"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("ai.improveFailed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/tickets/${ticketId}/comments`, {
        comment: commentText,
        isInternal: isInternalComment ? 1 : 0,
        sendEmail: canSendEmail ? sendEmail : false,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", ticketId, "comments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", ticketId, "activity"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", ticketId, "unread-counts"] });
      setCommentText("");
      setSendEmail(true);
      toast({ title: t("tickets.commentAdded") });
      onCommentAdded?.();
    },
    onError: (error: Error) => {
      toast({
        title: t("tickets.commentFailed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateFavoritesMutation = useMutation({
    mutationFn: async (nextFavorites: string[]) => {
      const response = await apiRequest("POST", "/api/templates/favorites", {
        favorites: nextFavorites,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/templates/favorites"] });
    },
    onError: (error: Error) => {
      toast({
        title: t("tickets.templateFavorites.saveError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const favoriteTemplates = templates.filter((template) => favorites.includes(template.id));
  const otherTemplates = templates.filter((template) => !favorites.includes(template.id));

  const toggleFavorite = (templateId: string) => {
    const nextFavorites = favorites.includes(templateId)
      ? favorites.filter((id) => id !== templateId)
      : [...favorites, templateId];
    updateFavoritesMutation.mutate(nextFavorites);
  };

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {templates.length > 0 && (
        <Select
          onValueChange={(templateId) => {
            const template = templates.find((t) => t.id === templateId);
            if (template) {
              setCommentText(template.content);
            }
          }}
        >
          <SelectTrigger aria-label={t("templates.useTemplate")} data-testid="select-template-comment">
            <SelectValue placeholder={t("templates.useTemplate")} />
          </SelectTrigger>
          <SelectContent>
            {favoriteTemplates.length > 0 && (
              <div className="px-2 py-1 text-xs text-muted-foreground">
                {t("tickets.templateFavorites.section")}
              </div>
            )}
            {favoriteTemplates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.title}
              </SelectItem>
            ))}
            {otherTemplates.length > 0 && (
              <div className="px-2 py-1 text-xs text-muted-foreground">
                {t("tickets.templateFavorites.all")}
              </div>
            )}
            {otherTemplates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {templates.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            {t("tickets.templateFavorites.manage")}
          </div>
          <div className="flex flex-wrap gap-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => toggleFavorite(template.id)}
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                  favorites.includes(template.id)
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                <Star className={`h-3 w-3 ${favorites.includes(template.id) ? "" : "opacity-50"}`} />
                {template.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {replyDraft && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2" data-testid="panel-reply-draft">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Bot className="h-4 w-4" />
              {t("tickets.replyDraft.title", { kind: t(`settings.integration.emailIntake.replyKind.${replyDraft.kind}`) })}
            </div>
            {replyDraft.status === "draft" && (
              <div className="flex gap-2">
                {replyDraft.draft && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setCommentText(replyDraft.draft ?? "")} data-testid="button-reply-draft-use">
                    {t("tickets.replyDraft.use")}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => regenerateMutation.mutate()}
                  disabled={regenerateMutation.isPending}
                  data-testid="button-reply-draft-regenerate"
                >
                  {regenerateMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                  {t("tickets.replyDraft.regenerate")}
                </Button>
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>{t("tickets.replyDraft.recipient", { email: replyDraft.customerEmail, mailbox: replyDraft.mailbox || t("tickets.replyDraft.defaultMailbox") })}</p>
            {replyDraft.order ? (
              <p>
                {t("tickets.replyDraft.order", { number: replyDraft.order.orderNumber, status: replyDraft.order.status })}
                {replyDraft.order.trackingCodes.length > 0 ? ` · ${t("tickets.replyDraft.tracking", { codes: replyDraft.order.trackingCodes.join(", ") })}` : ""}
              </p>
            ) : replyDraft.orderNumbers.length > 0 ? (
              <p>{t("tickets.replyDraft.orderMissing", { numbers: replyDraft.orderNumbers.join(", "), note: replyDraft.orderNote ?? "" })}</p>
            ) : null}
            {replyDraft.draftError && <p className="text-destructive">{replyDraft.draftError}</p>}
            {replyDraft.status === "draft" && <p>{t("tickets.replyDraft.sendHint")}</p>}
            {replyDraft.status === "queued" && <p className="font-medium">{t("tickets.replyDraft.statusQueued")}</p>}
            {replyDraft.status === "sent" && (
              <p className="font-medium text-green-700 dark:text-green-400">
                {t("tickets.replyDraft.statusSent", { date: replyDraft.sentAt ? new Date(replyDraft.sentAt).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" }) : "" })}
              </p>
            )}
            {replyDraft.status === "failed" && (
              <p className="font-medium text-destructive">{t("tickets.replyDraft.statusFailed", { error: replyDraft.lastError ?? "" })}</p>
            )}
          </div>
        </div>
      )}
      <div className="relative">
        <Textarea
          placeholder={t("tickets.addComment")}
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          rows={replyDraft ? 12 : compact ? 3 : 4}
          data-testid="input-comment"
        />
        {aiSettings?.enabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2"
            onClick={() => improveTextMutation.mutate(commentText)}
            disabled={!commentText.trim() || improveTextMutation.isPending}
            data-testid="button-improve-text"
            title={t("ai.improveText")}
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        )}
      </div>
      {placeholders.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400" data-testid="text-reply-placeholders">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{t("tickets.replyDraft.placeholders", { list: placeholders.join(", ") })}</span>
        </div>
      )}
      {canManageTickets && (
        <div className="flex items-center gap-2">
          <Switch
            id="internal-comment"
            checked={isInternalComment}
            onCheckedChange={setIsInternalComment}
            data-testid="switch-internal"
          />
          <Label htmlFor="internal-comment" className="text-sm">
            {t("tickets.internalNote")}
          </Label>
        </div>
      )}
      {canSendEmail && !isInternalComment && (
        <div className="flex items-center gap-2">
          <Switch
            id="send-email"
            checked={sendEmail}
            onCheckedChange={setSendEmail}
            data-testid="switch-send-email"
          />
          <Label htmlFor="send-email" className="text-sm">
            {t("tickets.sendEmailToCustomer")}
          </Label>
        </div>
      )}
      {isIntakeReply && !isInternalComment ? (
        <Button
          onClick={() => sendReplyMutation.mutate()}
          disabled={!replySendable || !commentText.trim() || placeholders.length > 0 || sendReplyMutation.isPending}
          data-testid="button-reply-draft-send"
        >
          {sendReplyMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
          {replyDraft?.status === "failed" ? t("tickets.replyDraft.resend") : t("tickets.replyDraft.send")}
        </Button>
      ) : (
        <Button
          onClick={() => addCommentMutation.mutate()}
          disabled={!commentText.trim() || addCommentMutation.isPending}
          data-testid="button-add-comment"
        >
          <Send className="h-4 w-4 mr-2" />
          {t("tickets.addComment")}
        </Button>
      )}
    </div>
  );
}
