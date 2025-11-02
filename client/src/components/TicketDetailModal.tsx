import { X, Send, Trash2, Link as LinkIcon } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import type { Ticket, TicketComment, User } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";

interface TicketDetailModalProps {
  ticket: Ticket | null;
  isOpen: boolean;
  onClose: () => void;
  canManageTickets: boolean;
}

export default function TicketDetailModal({
  ticket,
  isOpen,
  onClose,
  canManageTickets,
}: TicketDetailModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [commentText, setCommentText] = useState("");
  const [isInternalComment, setIsInternalComment] = useState(false);
  const [editingTicket, setEditingTicket] = useState(false);

  // Fetch comments for this ticket
  const { data: comments = [], isLoading: commentsLoading } = useQuery<TicketComment[]>({
    queryKey: ['/api/tickets', ticket?.id, 'comments'],
    queryFn: async () => {
      const response = await fetch(`/api/tickets/${ticket?.id}/comments`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    enabled: isOpen && !!ticket?.id,
  });

  // Fetch users for assignment (only if user can manage tickets)
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['/api/tickets/assignees'],
    enabled: canManageTickets && isOpen && !!ticket?.id,
  });

  const addCommentMutation = useMutation({
    mutationFn: async (data: { comment: string; isInternal: number }) => {
      if (!ticket?.id) throw new Error("No ticket ID");
      const response = await apiRequest("POST", `/api/tickets/${ticket.id}/comments`, data);
      return response.json();
    },
    onSuccess: () => {
      if (!ticket?.id) return;
      queryClient.invalidateQueries({ queryKey: ['/api/tickets', ticket.id, 'comments'] });
      setCommentText("");
      toast({
        title: t('tickets.commentAdded'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('tickets.commentFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateTicketMutation = useMutation({
    mutationFn: async (data: Partial<Ticket>) => {
      if (!ticket?.id) throw new Error("No ticket ID");
      const response = await apiRequest("PATCH", `/api/tickets/${ticket.id}`, data);
      return response.json();
    },
    onSuccess: () => {
      if (!ticket?.id) return;
      queryClient.invalidateQueries({ queryKey: ['/api/tickets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tickets', ticket.id] });
      toast({
        title: t('tickets.updateSuccess'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('tickets.updateFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteTicketMutation = useMutation({
    mutationFn: async () => {
      if (!ticket?.id) throw new Error("No ticket ID");
      const response = await apiRequest("DELETE", `/api/tickets/${ticket.id}`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tickets'] });
      onClose();
      toast({
        title: t('tickets.deleteSuccess'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('tickets.deleteFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!ticket) return null;

  const handleAddComment = () => {
    if (!commentText.trim()) return;
    addCommentMutation.mutate({
      comment: commentText,
      isInternal: isInternalComment ? 1 : 0,
    });
  };

  const handleUpdateStatus = (status: string) => {
    updateTicketMutation.mutate({ status });
  };

  const handleUpdatePriority = (priority: string) => {
    updateTicketMutation.mutate({ priority });
  };

  const handleUpdateAssignee = (userId: string) => {
    updateTicketMutation.mutate({ 
      assignedToUserId: userId === "unassigned" ? null : userId 
    });
  };

  const handleDeleteTicket = () => {
    if (confirm(t('tickets.deleteConfirm'))) {
      deleteTicketMutation.mutate();
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "open": return "default";
      case "in_progress": return "secondary";
      case "waiting_for_customer": return "outline";
      case "waiting_for_internal": return "outline";
      case "resolved": return "default";
      case "closed": return "secondary";
      default: return "default";
    }
  };

  const getPriorityBadgeVariant = (priority: string) => {
    switch (priority) {
      case "urgent": return "destructive";
      case "high": return "default";
      case "normal": return "secondary";
      case "low": return "outline";
      default: return "secondary";
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="modal-ticket-detail">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-mono text-muted-foreground" data-testid="text-ticket-number">
                  {ticket.ticketNumber}
                </span>
                <Badge variant={getPriorityBadgeVariant(ticket.priority)} data-testid="badge-priority">
                  {t(`tickets.priority${ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}`)}
                </Badge>
                <Badge variant={getStatusBadgeVariant(ticket.status)} data-testid="badge-status">
                  {t(`tickets.status${ticket.status.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join('')}`)}
                </Badge>
              </div>
              <DialogTitle className="text-2xl font-semibold" data-testid="text-ticket-title">
                {ticket.title}
              </DialogTitle>
            </div>
            {canManageTickets && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteTicket}
                data-testid="button-delete-ticket"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t('tickets.deleteTicket')}
              </Button>
            )}
          </div>
        </DialogHeader>

        <Tabs defaultValue="details" className="mt-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="details" data-testid="tab-details">{t('orderDetail.overview')}</TabsTrigger>
            <TabsTrigger value="comments" data-testid="tab-comments">{t('tickets.comments')}</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="pt-6 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t('tickets.description')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap" data-testid="text-description">{ticket.description}</p>
              </CardContent>
            </Card>

            {canManageTickets && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">{t('common.actions')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t('tickets.status')}</Label>
                    <Select value={ticket.status} onValueChange={handleUpdateStatus}>
                      <SelectTrigger data-testid="select-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">{t('tickets.statusOpen')}</SelectItem>
                        <SelectItem value="in_progress">{t('tickets.statusInProgress')}</SelectItem>
                        <SelectItem value="waiting_for_customer">{t('tickets.statusWaitingForCustomer')}</SelectItem>
                        <SelectItem value="waiting_for_internal">{t('tickets.statusWaitingForInternal')}</SelectItem>
                        <SelectItem value="resolved">{t('tickets.statusResolved')}</SelectItem>
                        <SelectItem value="closed">{t('tickets.statusClosed')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>{t('tickets.priority')}</Label>
                    <Select value={ticket.priority} onValueChange={handleUpdatePriority}>
                      <SelectTrigger data-testid="select-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">{t('tickets.priorityLow')}</SelectItem>
                        <SelectItem value="normal">{t('tickets.priorityNormal')}</SelectItem>
                        <SelectItem value="high">{t('tickets.priorityHigh')}</SelectItem>
                        <SelectItem value="urgent">{t('tickets.priorityUrgent')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>{t('tickets.assignToUser')}</Label>
                    <Select 
                      value={ticket.assignedToUserId || "unassigned"} 
                      onValueChange={handleUpdateAssignee}
                    >
                      <SelectTrigger data-testid="select-assignee">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">{t('tickets.unassigned')}</SelectItem>
                        {users.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.username}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t('tickets.relatedOrder')}</CardTitle>
              </CardHeader>
              <CardContent>
                {ticket.orderId ? (
                  <div className="flex items-center gap-2">
                    <LinkIcon className="h-4 w-4 text-muted-foreground" />
                    <span data-testid="text-order-link">
                      {ticket.orderNumber || ticket.orderId}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="text-no-order">
                    {t('tickets.noOrderLinked')}
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">{t('tickets.createdAt')}</p>
                <p className="font-medium" data-testid="text-created-at">
                  {format(new Date(ticket.createdAt), 'dd.MM.yyyy HH:mm')}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('tickets.updatedAt')}</p>
                <p className="font-medium" data-testid="text-updated-at">
                  {format(new Date(ticket.updatedAt), 'dd.MM.yyyy HH:mm')}
                </p>
              </div>
              {ticket.resolvedAt && (
                <div>
                  <p className="text-muted-foreground">{t('tickets.resolvedAt')}</p>
                  <p className="font-medium" data-testid="text-resolved-at">
                    {format(new Date(ticket.resolvedAt), 'dd.MM.yyyy HH:mm')}
                  </p>
                </div>
              )}
              {ticket.closedAt && (
                <div>
                  <p className="text-muted-foreground">{t('tickets.closedAt')}</p>
                  <p className="font-medium" data-testid="text-closed-at">
                    {format(new Date(ticket.closedAt), 'dd.MM.yyyy HH:mm')}
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="comments" className="pt-6 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t('tickets.addComment')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  placeholder={t('tickets.addComment')}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={4}
                  data-testid="input-comment"
                />
                {canManageTickets && (
                  <div className="flex items-center gap-2">
                    <Switch
                      id="internal-comment"
                      checked={isInternalComment}
                      onCheckedChange={setIsInternalComment}
                      data-testid="switch-internal"
                    />
                    <Label htmlFor="internal-comment" className="text-sm">
                      {t('tickets.internalNote')}
                    </Label>
                  </div>
                )}
                <Button
                  onClick={handleAddComment}
                  disabled={!commentText.trim() || addCommentMutation.isPending}
                  data-testid="button-add-comment"
                >
                  <Send className="h-4 w-4 mr-2" />
                  {t('tickets.addComment')}
                </Button>
              </CardContent>
            </Card>

            {commentsLoading ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">{t('common.loading')}</p>
              </div>
            ) : comments.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground">{t('tickets.comments')}: 0</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {comments.map((comment) => (
                  <Card key={comment.id} data-testid={`comment-${comment.id}`}>
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium" data-testid={`comment-user-${comment.id}`}>
                            {comment.userId}
                          </span>
                          {comment.isInternal === 1 && (
                            <Badge variant="outline" data-testid={`badge-internal-${comment.id}`}>
                              {t('tickets.internalNote')}
                            </Badge>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground" data-testid={`comment-time-${comment.id}`}>
                          {format(new Date(comment.createdAt), 'dd.MM.yyyy HH:mm')}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm" data-testid={`comment-content-${comment.id}`}>
                        {comment.comment}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
