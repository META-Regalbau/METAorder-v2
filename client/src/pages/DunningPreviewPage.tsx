import { useState, useEffect } from "react";
import { RefreshCw, Search, ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import OrderDetailModal from "@/components/OrderDetailModal";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Order } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { de, enUS, es } from "date-fns/locale";
import { apiRequest, queryClient } from "@/lib/queryClient";

type DunningPreviewItem = {
  order: Order;
  dueDate: string;
  daysOverdue: number;
  lastStage: number;
  nextStage: number;
};

type SortDirection = "asc" | "desc";
type DunningSortKey =
  | "orderNumber"
  | "customerName"
  | "dueDate"
  | "daysOverdue"
  | "nextStage"
  | "lastStage"
  | "totalAmount"
  | "paymentStatus";

interface DunningPreviewPageProps {
  userRole: "employee" | "admin";
}

export default function DunningPreviewPage({ userRole }: DunningPreviewPageProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [searchValue, setSearchValue] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemsPerPage, setItemsPerPage] = useState("25");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState<DunningSortKey>("daysOverdue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const dateLocale = i18n.language === 'de' ? de : i18n.language === 'es' ? es : enUS;

  const { data, isLoading, error, refetch } = useQuery<{ enabled: boolean; items: DunningPreviewItem[] }>({
    queryKey: ['/api/dunning/preview'],
    queryFn: async () => {
      const response = await fetch('/api/dunning/preview');
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    retry: false,
  });

  const items = data?.items || [];

  const sendDunningMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const response = await apiRequest("POST", "/api/dunning/send", { orderId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/dunning/preview'] });
      toast({
        title: t('dunningPreview.sendSuccess'),
        description: t('dunningPreview.sendSuccessDesc'),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('dunningPreview.sendError'),
        description: error?.message || t('dunningPreview.sendErrorDesc'),
        variant: "destructive",
      });
    },
  });

  if (error) {
    const errorMessage = (error as any)?.message || t('errors.loadFailed');
    if (errorMessage.includes('not configured')) {
      return (
        <div className="w-full">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold mb-1">{t('dunningPreview.title')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('errors.notConfiguredDescription')}
            </p>
          </div>
          <div className="bg-muted/50 border border-border rounded-lg p-8 text-center">
            <p className="text-muted-foreground mb-4">
              {t('errors.notConfigured')}
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {t('errors.notConfiguredDescription')}
            </p>
            <Button onClick={() => window.location.href = '/settings'} data-testid="button-go-to-settings">
              {t('errors.goToSettings')}
            </Button>
          </div>
        </div>
      );
    }
  }

  const normalizedSearch = searchValue.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    const order = item.order;
    return (
      normalizedSearch === "" ||
      order.orderNumber.toLowerCase().includes(normalizedSearch) ||
      order.customerName.toLowerCase().includes(normalizedSearch) ||
      order.customerEmail.toLowerCase().includes(normalizedSearch) ||
      order.invoiceNumber?.toLowerCase().includes(normalizedSearch) ||
      order.erpNumber?.toLowerCase().includes(normalizedSearch)
    );
  });

  const sortedItems = [...filteredItems].sort((a, b) => {
    const direction = sortDirection === "asc" ? 1 : -1;
    switch (sortKey) {
      case "orderNumber":
        return a.order.orderNumber.localeCompare(b.order.orderNumber) * direction;
      case "customerName":
        return a.order.customerName.localeCompare(b.order.customerName) * direction;
      case "dueDate":
        return (new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()) * direction;
      case "daysOverdue":
        return (a.daysOverdue - b.daysOverdue) * direction;
      case "nextStage":
        return (a.nextStage - b.nextStage) * direction;
      case "lastStage":
        return (a.lastStage - b.lastStage) * direction;
      case "totalAmount":
        return (a.order.totalAmount - b.order.totalAmount) * direction;
      case "paymentStatus":
        return a.order.paymentStatus.localeCompare(b.order.paymentStatus) * direction;
      default:
        return 0;
    }
  });

  const itemsPerPageNum = parseInt(itemsPerPage);
  const totalPages = Math.ceil(sortedItems.length / itemsPerPageNum);
  const startIndex = (currentPage - 1) * itemsPerPageNum;
  const endIndex = startIndex + itemsPerPageNum;
  const paginatedItems = sortedItems.slice(startIndex, endIndex);

  const resetPage = () => setCurrentPage(1);
  useEffect(resetPage, [searchValue, sortKey, sortDirection, itemsPerPage]);

  const handleSortChange = (key: DunningSortKey) => {
    setSortKey((current) => {
      if (current === key) {
        setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDirection("asc");
      return key;
    });
  };

  const renderSortIcon = (key: DunningSortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
    }
    return sortDirection === "asc" ? (
      <ChevronUp className="h-3 w-3 ml-1 opacity-80" />
    ) : (
      <ChevronDown className="h-3 w-3 ml-1 opacity-80" />
    );
  };

  // Mutation to update document numbers in Shopware
  const updateDocumentsMutation = useMutation({
    mutationFn: async ({ orderId, documentData }: { orderId: string; documentData: any }) => {
      const response = await apiRequest("PATCH", `/api/orders/${orderId}/documents`, documentData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/dunning/preview'] });
      toast({
        title: t('orderDetail.documentsUpdated'),
        description: t('orderDetail.documentsSuccess'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('errors.updateFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleUpdateDocuments = (orderId: string, data: any) => {
    updateDocumentsMutation.mutate({ orderId, documentData: data });
  };

  return (
    <div className="w-full">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">{t('dunningPreview.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('dunningPreview.description')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading} data-testid="button-refresh-dunning">
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          {t('common.refresh')}
        </Button>
      </div>

      {!data?.enabled && (
        <div className="mb-6 bg-muted/50 border border-border rounded-lg p-4 text-sm text-muted-foreground">
          {t('dunningPreview.disabled')}
        </div>
      )}

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('dunningPreview.filters')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t('common.search')}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="pl-9"
              data-testid="input-search-dunning"
            />
          </div>
          <Input
            value={itemsPerPage}
            onChange={(e) => setItemsPerPage(e.target.value)}
            type="number"
            min={5}
            max={100}
            data-testid="input-dunning-items-per-page"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('dunningPreview.tableTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">{t('common.loading')}</div>
          ) : paginatedItems.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t('dunningPreview.empty')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 cursor-pointer" onClick={() => handleSortChange("orderNumber")}>
                      {t('dunningPreview.orderNumber')}{renderSortIcon("orderNumber")}
                    </th>
                    <th className="py-2 cursor-pointer" onClick={() => handleSortChange("customerName")}>
                      {t('dunningPreview.customer')}{renderSortIcon("customerName")}
                    </th>
                    <th className="py-2 cursor-pointer" onClick={() => handleSortChange("dueDate")}>
                      {t('dunningPreview.invoiceCreatedAt')}{renderSortIcon("dueDate")}
                    </th>
                    <th className="py-2 cursor-pointer" onClick={() => handleSortChange("daysOverdue")}>
                      {t('dunningPreview.daysOverdue')}{renderSortIcon("daysOverdue")}
                    </th>
                    <th className="py-2 cursor-pointer" onClick={() => handleSortChange("lastStage")}>
                      {t('dunningPreview.lastStage')}{renderSortIcon("lastStage")}
                    </th>
                    <th className="py-2 cursor-pointer" onClick={() => handleSortChange("nextStage")}>
                      {t('dunningPreview.nextStage')}{renderSortIcon("nextStage")}
                    </th>
                    <th className="py-2 cursor-pointer" onClick={() => handleSortChange("totalAmount")}>
                      {t('dunningPreview.total')}{renderSortIcon("totalAmount")}
                    </th>
                    <th className="py-2 cursor-pointer" onClick={() => handleSortChange("paymentStatus")}>
                      {t('dunningPreview.paymentStatus')}{renderSortIcon("paymentStatus")}
                    </th>
                    <th className="py-2">{t('dunningPreview.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map((item) => (
                    <tr
                      key={item.order.id}
                      className="border-b hover:bg-muted/40 cursor-pointer"
                      onClick={() => {
                        setSelectedOrder(item.order);
                        setIsModalOpen(true);
                      }}
                      data-testid={`row-dunning-${item.order.id}`}
                    >
                      <td className="py-2 font-medium">{item.order.orderNumber}</td>
                      <td className="py-2">{item.order.customerName}</td>
                      <td className="py-2">
                        {format(new Date(item.dueDate), 'P', { locale: dateLocale })}
                      </td>
                      <td className="py-2">
                        <Badge variant={item.daysOverdue > 14 ? "destructive" : "secondary"}>
                          {item.daysOverdue}
                        </Badge>
                      </td>
                      <td className="py-2">{item.lastStage}</td>
                      <td className="py-2">{item.nextStage}</td>
                      <td className="py-2">€{item.order.totalAmount.toFixed(2)}</td>
                      <td className="py-2">
                        <Badge variant="outline">{t(`paymentStatus.${item.order.paymentStatus}`)}</Badge>
                      </td>
                      <td className="py-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!data?.enabled || sendDunningMutation.isPending}
                          onClick={(event) => {
                            event.stopPropagation();
                            sendDunningMutation.mutate(item.order.id);
                          }}
                          data-testid={`button-send-dunning-${item.order.id}`}
                        >
                          {t('dunningPreview.send')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <OrderDetailModal
        order={selectedOrder}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        userRole={userRole}
        userPermissions={undefined}
        onUpdateShipping={(_orderId, _data) => undefined}
        onUpdateDocuments={handleUpdateDocuments}
      />
    </div>
  );
}
