import { X, Send, Trash2, Link as LinkIcon, Clock } from "lucide-react";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Ticket, TicketComment, User, TicketAttachment } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import TagInput from "@/components/TagInput";
import { DatePicker } from "@/components/ui/date-picker";
import { FileUpload } from "@/components/FileUpload";
import { AttachmentsList } from "@/components/AttachmentsList";

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
  const [activeTab, setActiveTab] = useState("details");

  // Fetch comments for this ticket
  const { data: comments = [], isLoading: commentsLoading } = useQuery<TicketComment[]>({
    queryKey: ['/api/tickets', ticket?.id, 'comments'],
    queryFn: async () => {
      const response = await fetch(`/api/tickets/${ticket?.id}/comments`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    enabled: isOpen && !!ticket?.id,
  });

  // Fetch activity log for this ticket
  const { data: activityLogs = [], isLoading: activityLoading } = useQuery<any[]>({
    queryKey: ['/api/tickets', ticket?.id, 'activity'],
    queryFn: async () => {
      const response = await fetch(`/api/tickets/${ticket?.id}/activity`);
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

  // Fetch attachments for this ticket
  const { data: attachments = [], isLoading: attachmentsLoading } = useQuery<TicketAttachment[]>({
    queryKey: ['/api/tickets', ticket?.id, 'attachments'],
    enabled: isOpen && !!ticket?.id,
  });

  // Fetch unread counts for this ticket
  const { data: unreadCounts } = useQuery<{ unreadComments: number; unreadAttachments: number }>({
    queryKey: ['/api/tickets', ticket?.id, 'unread-counts'],
    enabled: isOpen && !!ticket?.id,
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
      queryClient.invalidateQueries({ queryKey: ['/api/tickets', ticket.id, 'activity'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tickets', ticket.id, 'unread-counts'] });
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
      queryClient.invalidateQueries({ queryKey: ['/api/tickets', ticket.id, 'activity'] });
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

  const uploadAttachmentsMutation = useMutation({
    mutationFn: async (files: File[]) => {
      if (!ticket?.id) throw new Error("No ticket ID");
      const formData = new FormData();
      files.forEach((file) => {
        formData.append('files', file);
      });
      
      // Get CSRF token from cookie
      const csrfToken = document.cookie.match(/csrf_token=([^;]+)/)?.[1];
      const headers: Record<string, string> = {};
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
      
      const response = await fetch(`/api/tickets/${ticket.id}/attachments`, {
        method: 'POST',
        headers,
        body: formData,
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error(await response.text());
      }
      
      return response.json();
    },
    onSuccess: () => {
      if (!ticket?.id) return;
      queryClient.invalidateQueries({ queryKey: ['/api/tickets', ticket.id, 'attachments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tickets', ticket.id, 'activity'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tickets', ticket.id, 'unread-counts'] });
      toast({
        title: t('tickets.uploadSuccess'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('tickets.uploadFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const markCommentsReadMutation = useMutation({
    mutationFn: async () => {
      if (!ticket?.id) throw new Error("No ticket ID");
      const response = await apiRequest("POST", `/api/tickets/${ticket.id}/comments/mark-read`, {});
      return response.json();
    },
    onSuccess: () => {
      if (!ticket?.id) return;
      queryClient.invalidateQueries({ queryKey: ['/api/tickets', ticket.id, 'unread-counts'] });
    },
  });

  const markAttachmentsReadMutation = useMutation({
    mutationFn: async () => {
      if (!ticket?.id) throw new Error("No ticket ID");
      const response = await apiRequest("POST", `/api/tickets/${ticket.id}/attachments/mark-read`, {});
      return response.json();
    },
    onSuccess: () => {
      if (!ticket?.id) return;
      queryClient.invalidateQueries({ queryKey: ['/api/tickets', ticket.id, 'unread-counts'] });
    },
  });

  // Auto mark-as-read when switching tabs (works with keyboard navigation too)
  useEffect(() => {
    if (!ticket?.id || !isOpen || !unreadCounts) return;
    
    if (activeTab === "comments" && unreadCounts.unreadComments > 0) {
      markCommentsReadMutation.mutate();
    } else if (activeTab === "attachments" && unreadCounts.unreadAttachments > 0) {
      markAttachmentsReadMutation.mutate();
    }
  }, [activeTab, ticket?.id, isOpen, unreadCounts]);

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

  const handleFilesSelected = (files: File[]) => {
    if (files.length > 0) {
      uploadAttachmentsMutation.mutate(files);
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
          <DialogDescription className="sr-only">
            {t('tickets.viewDetails')}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="details" data-testid="tab-details">{t('orderDetail.overview')}</TabsTrigger>
            <TabsTrigger 
              value="comments" 
              data-testid="tab-comments"
            >
              <span className="flex items-center gap-2">
                {t('tickets.comments')}
                {comments.length > 0 && unreadCounts !== undefined && (
                  <Badge 
                    variant={unreadCounts.unreadComments > 0 ? "destructive" : "success"}
                    data-testid="badge-comments-count"
                  >
                    {unreadCounts.unreadComments > 0 ? unreadCounts.unreadComments : "✓"}
                  </Badge>
                )}
              </span>
            </TabsTrigger>
            <TabsTrigger value="activity" data-testid="tab-activity">{t('tickets.activity')}</TabsTrigger>
            <TabsTrigger 
              value="attachments" 
              data-testid="tab-attachments"
            >
              <span className="flex items-center gap-2">
                {t('tickets.attachments')}
                {attachments.length > 0 && unreadCounts !== undefined && (
                  <Badge 
                    variant={unreadCounts.unreadAttachments > 0 ? "destructive" : "success"}
                    data-testid="badge-attachments-count"
                  >
                    {unreadCounts.unreadAttachments > 0 ? unreadCounts.unreadAttachments : "✓"}
                  </Badge>
                )}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="pt-6 space-y-6">
            {/* Prominente Beschreibung */}
            <div className="space-y-3">
              <h3 className="text-base font-medium">{t('tickets.description')}</h3>
              <Card>
                <CardContent className="pt-6">
                  <p className="whitespace-pre-wrap text-base leading-relaxed" data-testid="text-description">
                    {ticket.description}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Tags */}
            <div className="space-y-3">
              <h3 className="text-base font-medium">{t('tickets.tags')}</h3>
              <Card>
                <CardContent className="pt-6">
                  {canManageTickets ? (
                    <TagInput
                      tags={ticket.tags || []}
                      onTagsChange={(tags) => updateTicketMutation.mutate({ tags })}
                      placeholder={t('tickets.tagPlaceholder')}
                      suggestions={['urgent', 'bug', 'feature', 'documentation', 'question', 'enhancement', 'customer-issue', 'internal']}
                    />
                  ) : (
                    <div className="flex flex-wrap gap-2" data-testid="tags-readonly">
                      {ticket.tags && ticket.tags.length > 0 ? (
                        ticket.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" data-testid={`tag-${tag}`}>
                            {tag}
                          </Badge>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">{t('tickets.noTags')}</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Aktionen in 3 Spalten */}
            {canManageTickets && (
              <div className="space-y-3">
                <h3 className="text-base font-medium">{t('common.actions')}</h3>
                <Card>
                  <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                    </div>

                    <div className="space-y-2 mt-4">
                      <Label>{t('tickets.dueDate')}</Label>
                      <DatePicker
                        date={ticket.dueDate ? new Date(ticket.dueDate) : undefined}
                        onDateChange={(date) => updateTicketMutation.mutate({ dueDate: date })}
                        placeholder={t('tickets.dueDatePlaceholder')}
                        testId="input-due-date-edit"
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Zusätzliche Informationen */}
            <div className="space-y-3">
              <h3 className="text-base font-medium">{t('tickets.relatedOrder')}</h3>
              <Card>
                <CardContent className="pt-6">
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
            </div>

            {/* Zeitstempel */}
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground mb-1">{t('tickets.createdAt')}</p>
                    <p className="font-medium" data-testid="text-created-at">
                      {format(new Date(ticket.createdAt), 'dd.MM.yyyy HH:mm')}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">{t('tickets.updatedAt')}</p>
                    <p className="font-medium" data-testid="text-updated-at">
                      {format(new Date(ticket.updatedAt), 'dd.MM.yyyy HH:mm')}
                    </p>
                  </div>
                  {ticket.resolvedAt && (
                    <div>
                      <p className="text-muted-foreground mb-1">{t('tickets.resolvedAt')}</p>
                      <p className="font-medium" data-testid="text-resolved-at">
                        {format(new Date(ticket.resolvedAt), 'dd.MM.yyyy HH:mm')}
                      </p>
                    </div>
                  )}
                  {ticket.closedAt && (
                    <div>
                      <p className="text-muted-foreground mb-1">{t('tickets.closedAt')}</p>
                      <p className="font-medium" data-testid="text-closed-at">
                        {format(new Date(ticket.closedAt), 'dd.MM.yyyy HH:mm')}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Ticket löschen */}
            {canManageTickets && (
              <div className="pt-4">
                <Button
                  variant="destructive"
                  size="default"
                  onClick={handleDeleteTicket}
                  data-testid="button-delete-ticket"
                  className="w-full"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t('tickets.deleteTicket')}
                </Button>
              </div>
            )}
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

          <TabsContent value="activity" className="pt-6 space-y-4">
            {activityLoading ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">{t('common.loading')}</p>
              </div>
            ) : activityLogs.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground">{t('tickets.noActivity')}</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {activityLogs.map((log: any) => {
                  const actionKey = log.action.replace(/_/g, '.');
                  const translateAction = (action: string) => {
                    return t(`tickets.activity.${action}`, { defaultValue: action });
                  };

                  const formatValue = (value: string | null, fieldName: string) => {
                    if (!value) return t('tickets.activity.empty');
                    
                    // Parse JSON arrays (tags)
                    try {
                      const parsed = JSON.parse(value);
                      if (Array.isArray(parsed)) {
                        return parsed.join(', ');
                      }
                    } catch {
                      // Not JSON, proceed with normal formatting
                    }

                    // Format dates
                    if (fieldName === 'dueDate' && value !== 'null') {
                      try {
                        return format(new Date(value), 'dd.MM.yyyy HH:mm');
                      } catch {
                        return value;
                      }
                    }

                    // Translate status/priority/category
                    if (fieldName === 'status') {
                      return t(`tickets.status${value.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join('')}`);
                    }
                    if (fieldName === 'priority') {
                      return t(`tickets.priority${value.charAt(0).toUpperCase() + value.slice(1)}`);
                    }
                    if (fieldName === 'category') {
                      return t(`tickets.category${value.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join('')}`);
                    }

                    return value;
                  };

                  return (
                    <Card key={log.id} data-testid={`activity-${log.id}`}>
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium" data-testid={`activity-user-${log.id}`}>
                                {log.username}
                              </span>
                              <span className="text-sm text-muted-foreground">
                                {translateAction(log.action)}
                              </span>
                            </div>
                            {log.oldValue !== null && log.newValue !== null && (
                              <div className="text-sm text-muted-foreground">
                                <span className="line-through">{formatValue(log.oldValue, log.fieldName)}</span>
                                {' → '}
                                <span className="font-medium text-foreground">{formatValue(log.newValue, log.fieldName)}</span>
                              </div>
                            )}
                            {log.oldValue === null && log.newValue !== null && (
                              <div className="text-sm text-muted-foreground">
                                <span className="font-medium text-foreground">{formatValue(log.newValue, log.fieldName)}</span>
                              </div>
                            )}
                          </div>
                          <span className="text-sm text-muted-foreground whitespace-nowrap" data-testid={`activity-time-${log.id}`}>
                            {format(new Date(log.createdAt), 'dd.MM.yyyy HH:mm')}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="attachments" className="pt-6 space-y-6">
            {canManageTickets && (
              <div className="space-y-3" data-testid="section-upload-attachments">
                <h3 className="text-base font-medium">{t('tickets.uploadAttachments')}</h3>
                <Card>
                  <CardContent className="pt-6">
                    <FileUpload
                      onFilesSelected={handleFilesSelected}
                      disabled={uploadAttachmentsMutation.isPending}
                      maxFiles={10}
                    />
                  </CardContent>
                </Card>
              </div>
            )}

            <div className="space-y-3" data-testid="section-attachments-list">
              <h3 className="text-base font-medium">{t('tickets.attachments')}</h3>
              <Card>
                <CardContent className="pt-6">
                  {attachmentsLoading ? (
                    <div className="text-center py-4">
                      <p className="text-muted-foreground">{t('common.loading')}</p>
                    </div>
                  ) : (
                    <AttachmentsList
                      ticketId={ticket.id}
                      attachments={attachments}
                      canDelete={canManageTickets}
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
