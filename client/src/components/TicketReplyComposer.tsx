import { Send, Sparkles, Star } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

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
  const { t } = useTranslation();
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

  const canSendEmail = Boolean(outboundStatus?.enabled && (ticket?.customerEmail || ticket?.emailFrom));

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
          <SelectTrigger data-testid="select-template-comment">
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
      <div className="relative">
        <Textarea
          placeholder={t("tickets.addComment")}
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          rows={compact ? 3 : 4}
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
      <Button
        onClick={() => addCommentMutation.mutate()}
        disabled={!commentText.trim() || addCommentMutation.isPending}
        data-testid="button-add-comment"
      >
        <Send className="h-4 w-4 mr-2" />
        {t("tickets.addComment")}
      </Button>
    </div>
  );
}
