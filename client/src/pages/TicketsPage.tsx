import { useState, useEffect } from "react";
import { Plus, Search, User as UserIcon, Download } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import TicketDetailModal from "@/components/TicketDetailModal";
import CreateTicketDialog from "@/components/CreateTicketDialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import type { Ticket, User, Role } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";

interface TicketsPageProps {
  userPermissions: Role['permissions'];
}

export default function TicketsPage({ userPermissions }: TicketsPageProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [searchValue, setSearchValue] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [showMyTicketsOnly, setShowMyTicketsOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(25);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const canViewTickets = userPermissions?.viewTickets || false;
  const canManageTickets = userPermissions?.manageTickets || false;

  // Export function
  const handleExport = async (format: 'csv' | 'excel') => {
    setIsExporting(true);
    try {
      const filters = {
        status: statusFilter,
        priority: priorityFilter,
        category: categoryFilter,
        assigneeId: assigneeFilter,
        tag: tagFilter,
        search: searchValue,
        showMyTicketsOnly,
      };

      const response = await fetch('/api/tickets/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ format, filters }),
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Download file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tickets-${Date.now()}.${format === 'csv' ? 'csv' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: t('tickets.exportSuccess'),
        description: t('tickets.exportDescription', { format: format.toUpperCase() }),
      });
    } catch (error) {
      toast({
        title: t('tickets.exportFailed'),
        description: t('tickets.exportError'),
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Redirect if user doesn't have viewTickets permission (only after permissions are loaded)
  useEffect(() => {
    if (userPermissions && !canViewTickets) {
      setLocation("/");
      toast({
        title: t('common.accessDenied'),
        description: t('common.noPermission'),
        variant: "destructive",
      });
    }
  }, [userPermissions, canViewTickets, setLocation, toast, t]);

  // Fetch current user
  const { data: currentUser } = useQuery<{ user: User & { permissions: Role['permissions'] } }>({
    queryKey: ['/api/auth/me'],
  });

  // Fetch users for assignee filter
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['/api/tickets/assignees'],
    enabled: canManageTickets,
  });

  // Fetch tickets
  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({
    queryKey: ['/api/tickets'],
    queryFn: async () => {
      const response = await fetch('/api/tickets');
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    retry: false,
  });

  // Handle ticketId query parameter from URL (e.g., from notifications)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ticketId = params.get('ticketId');
    
    if (ticketId && tickets.length > 0) {
      const ticket = tickets.find(t => t.id === ticketId);
      if (ticket) {
        setSelectedTicketId(ticket.id);
        setIsDetailModalOpen(true);
        // Clean up URL after opening modal
        window.history.replaceState({}, '', '/tickets');
      }
    }
  }, [tickets]);

  // Collect all unique tags from tickets
  const allTags = Array.from(new Set(tickets.flatMap(ticket => ticket.tags || []))).sort();

  // Filter tickets
  const filteredTickets = tickets
    .filter((ticket) => {
      const matchesSearch =
        searchValue === "" ||
        ticket.ticketNumber.toLowerCase().includes(searchValue.toLowerCase()) ||
        ticket.title.toLowerCase().includes(searchValue.toLowerCase()) ||
        (ticket.description?.toLowerCase() || "").includes(searchValue.toLowerCase());

      const matchesStatus = statusFilter === "all" || ticket.status === statusFilter;
      const matchesPriority = priorityFilter === "all" || ticket.priority === priorityFilter;
      const matchesCategory = categoryFilter === "all" || ticket.category === categoryFilter;
      
      const matchesAssignee = 
        assigneeFilter === "all" || 
        (assigneeFilter === "unassigned" && !ticket.assignedToUserId) ||
        ticket.assignedToUserId === assigneeFilter;

      const matchesTag = tagFilter === "all" || (ticket.tags && ticket.tags.includes(tagFilter));

      const matchesMyTickets = !showMyTicketsOnly || ticket.assignedToUserId === currentUser?.user?.id;

      return matchesSearch && matchesStatus && matchesPriority && matchesCategory && matchesAssignee && matchesTag && matchesMyTickets;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Pagination
  const totalPages = Math.ceil(filteredTickets.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedTickets = filteredTickets.slice(startIndex, endIndex);

  const resetPage = () => setCurrentPage(1);

  const activeFiltersCount = [
    statusFilter !== "all",
    priorityFilter !== "all",
    categoryFilter !== "all",
    assigneeFilter !== "all",
    tagFilter !== "all",
    showMyTicketsOnly,
  ].filter(Boolean).length;

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

  const getDueDateInfo = (dueDate: Date | null) => {
    if (!dueDate) return null;
    
    const now = new Date();
    const due = new Date(dueDate);
    const diffMs = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { label: t('tickets.overdue'), variant: 'destructive' as const };
    } else if (diffDays === 0) {
      return { label: t('tickets.dueToday'), variant: 'default' as const };
    } else if (diffDays <= 3) {
      return { label: t('tickets.dueSoon'), variant: 'outline' as const };
    }
    return null;
  };

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1" data-testid="text-page-title">{t('tickets.title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('tickets.showing', { count: filteredTickets.length, total: tickets.length })}
        </p>
      </div>

      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('tickets.searchPlaceholder')}
              value={searchValue}
              onChange={(e) => {
                setSearchValue(e.target.value);
                resetPage();
              }}
              className="pl-9"
              data-testid="input-search-tickets"
            />
          </div>
          <Button
            onClick={() => setIsCreateDialogOpen(true)}
            data-testid="button-create-ticket"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('tickets.createTicket')}
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={isExporting} data-testid="button-export-tickets">
                <Download className="h-4 w-4 mr-2" />
                {isExporting ? t('common.loading') : t('tickets.export')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleExport('csv')} data-testid="menu-export-csv">
                {t('tickets.exportCSV')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('excel')} data-testid="menu-export-excel">
                {t('tickets.exportExcel')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); resetPage(); }}>
            <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
              <SelectValue placeholder={t('tickets.filterByStatus')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('tickets.allStatuses')}</SelectItem>
              <SelectItem value="open">{t('tickets.statusOpen')}</SelectItem>
              <SelectItem value="in_progress">{t('tickets.statusInProgress')}</SelectItem>
              <SelectItem value="waiting_for_customer">{t('tickets.statusWaitingForCustomer')}</SelectItem>
              <SelectItem value="waiting_for_internal">{t('tickets.statusWaitingForInternal')}</SelectItem>
              <SelectItem value="resolved">{t('tickets.statusResolved')}</SelectItem>
              <SelectItem value="closed">{t('tickets.statusClosed')}</SelectItem>
            </SelectContent>
          </Select>

          <Select value={priorityFilter} onValueChange={(value) => { setPriorityFilter(value); resetPage(); }}>
            <SelectTrigger className="w-[180px]" data-testid="select-priority-filter">
              <SelectValue placeholder={t('tickets.filterByPriority')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('tickets.allPriorities')}</SelectItem>
              <SelectItem value="low">{t('tickets.priorityLow')}</SelectItem>
              <SelectItem value="normal">{t('tickets.priorityNormal')}</SelectItem>
              <SelectItem value="high">{t('tickets.priorityHigh')}</SelectItem>
              <SelectItem value="urgent">{t('tickets.priorityUrgent')}</SelectItem>
            </SelectContent>
          </Select>

          <Select value={categoryFilter} onValueChange={(value) => { setCategoryFilter(value); resetPage(); }}>
            <SelectTrigger className="w-[200px]" data-testid="select-category-filter">
              <SelectValue placeholder={t('tickets.filterByCategory')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('tickets.allCategories')}</SelectItem>
              <SelectItem value="general">{t('tickets.categoryGeneral')}</SelectItem>
              <SelectItem value="order_issue">{t('tickets.categoryOrderIssue')}</SelectItem>
              <SelectItem value="product_inquiry">{t('tickets.categoryProductInquiry')}</SelectItem>
              <SelectItem value="technical_support">{t('tickets.categoryTechnicalSupport')}</SelectItem>
              <SelectItem value="complaint">{t('tickets.categoryComplaint')}</SelectItem>
              <SelectItem value="feature_request">{t('tickets.categoryFeatureRequest')}</SelectItem>
              <SelectItem value="other">{t('tickets.categoryOther')}</SelectItem>
            </SelectContent>
          </Select>

          {canManageTickets && users.length > 0 && (
            <Select value={assigneeFilter} onValueChange={(value) => { setAssigneeFilter(value); resetPage(); }}>
              <SelectTrigger className="w-[200px]" data-testid="select-assignee-filter">
                <SelectValue placeholder={t('tickets.filterByAssignee')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('tickets.allAssignees')}</SelectItem>
                <SelectItem value="unassigned">{t('tickets.unassigned')}</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            variant={showMyTicketsOnly ? "default" : "outline"}
            onClick={() => {
              setShowMyTicketsOnly(!showMyTicketsOnly);
              resetPage();
            }}
            data-testid="button-my-tickets"
          >
            <UserIcon className="h-4 w-4 mr-2" />
            {t('tickets.myTickets')}
          </Button>

          {allTags.length > 0 && (
            <Select value={tagFilter} onValueChange={(value) => { setTagFilter(value); resetPage(); }}>
              <SelectTrigger className="w-[180px]" data-testid="select-tag-filter">
                <SelectValue placeholder={t('tickets.filterByTag')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('tickets.allTags')}</SelectItem>
                {allTags.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {activeFiltersCount > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                setStatusFilter("all");
                setPriorityFilter("all");
                setCategoryFilter("all");
                setAssigneeFilter("all");
                setTagFilter("all");
                setShowMyTicketsOnly(false);
                resetPage();
              }}
              data-testid="button-clear-filters"
            >
              {t('filters.clearAll')} ({activeFiltersCount})
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">{t('common.loading')}</p>
        </div>
      ) : paginatedTickets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{t('tickets.noTickets')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {paginatedTickets.map((ticket) => (
            <Card key={ticket.id} className="hover-elevate cursor-pointer" data-testid={`card-ticket-${ticket.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-mono text-muted-foreground" data-testid={`text-ticket-number-${ticket.id}`}>
                        {ticket.ticketNumber}
                      </span>
                      <Badge variant={getPriorityBadgeVariant(ticket.priority)} data-testid={`badge-priority-${ticket.id}`}>
                        {t(`tickets.priority${ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}`)}
                      </Badge>
                      <Badge variant={getStatusBadgeVariant(ticket.status)} data-testid={`badge-status-${ticket.id}`}>
                        {t(`tickets.status${ticket.status.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join('')}`)}
                      </Badge>
                      {(() => {
                        const dueDateInfo = getDueDateInfo(ticket.dueDate);
                        return dueDateInfo ? (
                          <Badge variant={dueDateInfo.variant} data-testid={`badge-due-date-${ticket.id}`}>
                            {dueDateInfo.label}
                          </Badge>
                        ) : null;
                      })()}
                    </div>
                    <CardTitle className="text-base" data-testid={`text-subject-${ticket.id}`}>
                      {ticket.title}
                    </CardTitle>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedTicketId(ticket.id);
                      setIsDetailModalOpen(true);
                    }}
                    data-testid={`button-view-ticket-${ticket.id}`}
                  >
                    {t('tickets.viewDetails')}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-2">
                  <span data-testid={`text-category-${ticket.id}`}>
                    {t(`tickets.category${ticket.category.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join('')}`)}
                  </span>
                  {ticket.assignedToUserId && (
                    <span data-testid={`text-assigned-${ticket.id}`} className="flex items-center gap-1">
                      <UserIcon className="h-3 w-3" />
                      {(ticket as any).assignedToUsername || ticket.assignedToUserId}
                    </span>
                  )}
                  {!ticket.assignedToUserId && (
                    <span data-testid={`text-unassigned-${ticket.id}`} className="text-muted-foreground">
                      {t('tickets.unassigned')}
                    </span>
                  )}
                  {ticket.orderId && (
                    <span data-testid={`text-order-link-${ticket.id}`}>
                      {t('tickets.relatedOrder')}: {ticket.orderId}
                    </span>
                  )}
                  <span data-testid={`text-created-at-${ticket.id}`}>
                    {t('tickets.createdAt')}: {format(new Date(ticket.createdAt), 'dd.MM.yyyy HH:mm')}
                  </span>
                </div>
                {ticket.tags && ticket.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2" data-testid={`tags-${ticket.id}`}>
                    {ticket.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs" data-testid={`tag-${tag}-${ticket.id}`}>
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              data-testid="button-first-page"
            >
              {t('common.first')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(currentPage - 1)}
              disabled={currentPage === 1}
              data-testid="button-previous-page"
            >
              {t('common.previous')}
            </Button>
          </div>
          <span className="text-sm text-muted-foreground" data-testid="text-pagination-info">
            {t('common.page')} {currentPage} {t('common.of')} {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              data-testid="button-next-page"
            >
              {t('common.next')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              data-testid="button-last-page"
            >
              {t('common.last')}
            </Button>
          </div>
        </div>
      )}

      <TicketDetailModal
        ticketId={selectedTicketId}
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedTicketId(null);
        }}
        canManageTickets={canManageTickets}
      />

      <CreateTicketDialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
      />
    </div>
  );
}
