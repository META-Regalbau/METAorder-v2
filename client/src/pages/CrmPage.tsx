import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import type { DiscountRequest, OrderAssignment, Role } from "@shared/schema";
import CustomerDetailModal from "@/components/CustomerDetailModal";
import { SalesChannelSelector } from "@/components/SalesChannelSelector";

type CrmCustomer = {
  id: string | null;
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  status: string;
  tags: string[];
  totalOrders: number;
  totalRevenue: number;
  lastOrderNumber?: string | null;
  lastOrderDate?: string | null;
  salesChannelIds?: string[];
};

type EnrichedAssignment = OrderAssignment & {
  requestedByUserName?: string | null;
  assignedToUserName?: string | null;
  approvedByUserName?: string | null;
};

type EnrichedDiscountRequest = DiscountRequest & {
  requestedByUserName?: string | null;
  approvedByUserName?: string | null;
};

interface CrmPageProps {
  userPermissions: Role["permissions"];
  userRole?: "employee" | "admin";
  userSalesChannelIds?: string[] | null;
}

export default function CrmPage({ userPermissions, userRole, userSalesChannelIds }: CrmPageProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [searchValue, setSearchValue] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CrmCustomer | null>(null);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [onlyIndividualPrices, setOnlyIndividualPrices] = useState(false);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);

  const canViewCrm = userPermissions?.viewCrm || false;
  const canManageCrm = userPermissions?.manageCrm || false;
  const canApproveCrm = userPermissions?.approveCrm || false;

  const { data: customersData, isLoading: customersLoading } = useQuery<{ customers: CrmCustomer[] }>({
    queryKey: ["/api/crm/customers", searchValue],
    queryFn: async () => {
      const query = searchValue.trim();
      const url = query ? `/api/crm/customers?q=${encodeURIComponent(query)}` : "/api/crm/customers";
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    enabled: canViewCrm,
  });

  const { data: individualPricesIndex, isLoading: individualPricesLoading } = useQuery<{
    configured: boolean;
    pluginDetected: boolean;
    customerCount: number;
    emails: string[];
  }>({
    queryKey: ["/api/crm/customers/individual-prices-index"],
    enabled: canViewCrm,
    staleTime: 5 * 60 * 1000,
  });

  const { data: assignments = [] } = useQuery<EnrichedAssignment[]>({
    queryKey: ["/api/crm/assignments"],
    enabled: canViewCrm,
  });

  const { data: discountRequests = [] } = useQuery<EnrichedDiscountRequest[]>({
    queryKey: ["/api/crm/discount-requests"],
    enabled: canViewCrm,
  });

  const approveAssignmentMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/crm/assignments/${id}/approve`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/assignments"] });
      toast({ title: t("crm.assignmentApproved") });
    },
    onError: (error: Error) => {
      toast({ title: t("crm.assignmentFailed"), description: error.message, variant: "destructive" });
    },
  });

  const rejectAssignmentMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/crm/assignments/${id}/reject`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/assignments"] });
      toast({ title: t("crm.assignmentRejected") });
    },
    onError: (error: Error) => {
      toast({ title: t("crm.assignmentFailed"), description: error.message, variant: "destructive" });
    },
  });

  const approveDiscountMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/crm/discount-requests/${id}/approve`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/discount-requests"] });
      toast({ title: t("crm.discountApproved") });
    },
    onError: (error: Error) => {
      toast({ title: t("crm.discountFailed"), description: error.message, variant: "destructive" });
    },
  });

  const rejectDiscountMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/crm/discount-requests/${id}/reject`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/discount-requests"] });
      toast({ title: t("crm.discountRejected") });
    },
    onError: (error: Error) => {
      toast({ title: t("crm.discountFailed"), description: error.message, variant: "destructive" });
    },
  });

  const customers = customersData?.customers || [];

  const individualPriceEmails = useMemo(
    () => new Set((individualPricesIndex?.emails || []).map((email) => email.toLowerCase())),
    [individualPricesIndex]
  );
  const hasIndividualPrice = (email: string) => individualPriceEmails.has((email || "").toLowerCase());

  const filteredCustomers = useMemo(() => {
    let result = customers;
    if (selectedChannelIds.length > 0) {
      result = result.filter((customer) =>
        (customer.salesChannelIds || []).some((channelId) => selectedChannelIds.includes(channelId))
      );
    }
    if (onlyIndividualPrices) {
      result = result.filter((customer) => hasIndividualPrice(customer.email));
    }
    return result;
  }, [customers, onlyIndividualPrices, individualPriceEmails, selectedChannelIds]);

  const pendingAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.status === "requested"),
    [assignments]
  );
  const pendingDiscounts = useMemo(
    () => discountRequests.filter((request) => request.status === "requested"),
    [discountRequests]
  );

  useEffect(() => {
    if (userPermissions && !canViewCrm) {
      setLocation("/");
      toast({
        title: t("common.accessDenied"),
        description: t("common.noPermission"),
        variant: "destructive",
      });
    }
  }, [canViewCrm, setLocation, t, toast, userPermissions]);

  useEffect(() => {
    if (!canViewCrm) return;
    const params = new URLSearchParams(window.location.search);
    const customerId = params.get("customerId");
    const customerEmail = params.get("customerEmail");
    const customerName = params.get("customerName");
    if (!customerId && !customerEmail) return;

    const match =
      customers.find((customer) => (customerId && customer.id === customerId) || (customerEmail && customer.email === customerEmail)) ||
      null;

    if (match) {
      setSelectedCustomer(match);
    } else {
      setSelectedCustomer({
        id: customerId,
        email: customerEmail || "",
        name: customerName || customerEmail || t("common.unknown"),
        phone: null,
        company: null,
        status: "active",
        tags: [],
        totalOrders: 0,
        totalRevenue: 0,
        lastOrderNumber: null,
        lastOrderDate: null,
      });
    }
    setIsCustomerModalOpen(true);
    window.history.replaceState({}, "", "/crm");
  }, [canViewCrm, customers, location, t]);

  if (!canViewCrm) {
    return null;
  }

  const handleCustomerOpen = (customer: CrmCustomer) => {
    setSelectedCustomer(customer);
    setIsCustomerModalOpen(true);
  };

  const activeCustomer = selectedCustomer;
  const isModalOpen = isCustomerModalOpen;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("crm.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("crm.description")}</p>
      </div>

      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers">{t("crm.tabs.customers")}</TabsTrigger>
          <TabsTrigger value="assignments">{t("crm.tabs.assignments")}</TabsTrigger>
          <TabsTrigger value="discounts">{t("crm.tabs.discounts")}</TabsTrigger>
        </TabsList>

        <TabsContent value="customers" className="mt-4">
          <Card>
            <CardHeader className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle>{t("crm.customers.title")}</CardTitle>
                  {individualPricesIndex?.pluginDetected && (
                    <Badge variant="secondary">
                      {t("crm.customers.individualPricesCount", { count: individualPricesIndex.customerCount })}
                    </Badge>
                  )}
                </div>
                <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center md:w-auto">
                  <SalesChannelSelector
                    selectedChannelIds={selectedChannelIds}
                    onSelectionChange={setSelectedChannelIds}
                    userAllowedChannelIds={userSalesChannelIds}
                    isAdmin={userRole === "admin"}
                    enabled={canViewCrm}
                  />
                  <div className="flex w-full max-w-sm items-center gap-2">
                    <Input
                      value={searchValue}
                      onChange={(event) => setSearchValue(event.target.value)}
                      placeholder={t("crm.customers.searchPlaceholder")}
                    />
                    <Button variant="outline" onClick={() => setSearchValue("")}>
                      {t("common.clear")}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="only-individual-prices"
                  checked={onlyIndividualPrices}
                  onCheckedChange={setOnlyIndividualPrices}
                  disabled={individualPricesLoading || !individualPricesIndex?.pluginDetected}
                />
                <Label htmlFor="only-individual-prices" className="text-sm font-normal text-muted-foreground">
                  {t("crm.customers.onlyIndividualPrices")}
                </Label>
              </div>
            </CardHeader>
            <CardContent>
              {customersLoading ? (
                <div className="py-8 text-center text-muted-foreground">{t("common.loading")}</div>
              ) : filteredCustomers.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  {onlyIndividualPrices ? t("crm.customers.emptyIndividualPrices") : t("crm.customers.empty")}
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>{t("crm.customers.name")}</TableHead>
                        <TableHead>{t("crm.customers.contact")}</TableHead>
                        <TableHead>{t("crm.customers.lastOrder")}</TableHead>
                        <TableHead className="text-right">{t("crm.customers.totalRevenue")}</TableHead>
                        <TableHead className="text-right">{t("common.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCustomers.map((customer) => (
                        <TableRow key={customer.email} className="hover-elevate">
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{customer.name}</span>
                              {hasIndividualPrice(customer.email) && (
                                <Badge className="bg-green-600 hover:bg-green-600">
                                  {t("crm.customers.individualPriceBadge")}
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">{customer.company || "—"}</div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{customer.email}</div>
                            <div className="text-xs text-muted-foreground">{customer.phone || "—"}</div>
                          </TableCell>
                          <TableCell className="text-sm">
                            <div>{customer.lastOrderNumber || "—"}</div>
                            <div className="text-xs text-muted-foreground">
                              {customer.lastOrderDate ? new Date(customer.lastOrderDate).toLocaleDateString() : "—"}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="font-medium">€{customer.totalRevenue.toFixed(2)}</div>
                            <div className="text-xs text-muted-foreground">{t("crm.customers.orders", { count: customer.totalOrders })}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => handleCustomerOpen(customer)}>
                              {t("crm.customers.open")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assignments" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("crm.assignments.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              {assignments.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground">{t("crm.assignments.empty")}</div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>{t("crm.assignments.order")}</TableHead>
                        <TableHead>{t("crm.assignments.assignee")}</TableHead>
                        <TableHead>{t("crm.assignments.status")}</TableHead>
                        <TableHead>{t("crm.assignments.requestedBy")}</TableHead>
                        <TableHead className="text-right">{t("common.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assignments.map((assignment) => (
                        <TableRow key={assignment.id}>
                          <TableCell className="font-mono">{assignment.orderNumber}</TableCell>
                          <TableCell>{assignment.assignedToUserName || "—"}</TableCell>
                          <TableCell>
                            <Badge variant={assignment.status === "approved" ? "default" : assignment.status === "rejected" ? "destructive" : "outline"}>
                              {t(`crm.assignments.status.${assignment.status}`)}
                            </Badge>
                          </TableCell>
                          <TableCell>{assignment.requestedByUserName || "—"}</TableCell>
                          <TableCell className="text-right">
                            {canApproveCrm && assignment.status === "requested" ? (
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => approveAssignmentMutation.mutate(assignment.id)}
                                  disabled={approveAssignmentMutation.isPending}
                                >
                                  {t("crm.approve")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => rejectAssignmentMutation.mutate(assignment.id)}
                                  disabled={rejectAssignmentMutation.isPending}
                                >
                                  {t("crm.reject")}
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {canApproveCrm && pendingAssignments.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("crm.assignments.pendingCount", { count: pendingAssignments.length })}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="discounts" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("crm.discounts.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              {discountRequests.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground">{t("crm.discounts.empty")}</div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>{t("crm.discounts.customer")}</TableHead>
                        <TableHead>{t("crm.discounts.order")}</TableHead>
                        <TableHead>{t("crm.discounts.amount")}</TableHead>
                        <TableHead>{t("crm.discounts.status")}</TableHead>
                        <TableHead>{t("crm.discounts.requestedBy")}</TableHead>
                        <TableHead className="text-right">{t("common.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {discountRequests.map((request) => (
                        <TableRow key={request.id}>
                          <TableCell>
                            <div className="font-medium">{request.customerName || request.customerEmail}</div>
                            <div className="text-xs text-muted-foreground">{request.customerEmail}</div>
                          </TableCell>
                          <TableCell className="font-mono">{request.orderNumber || "—"}</TableCell>
                          <TableCell>
                            {request.discountType === "percent"
                              ? `${request.discountValue}%`
                              : `€${Number(request.discountValue).toFixed(2)}`}
                          </TableCell>
                          <TableCell>
                            <Badge variant={request.status === "approved" ? "default" : request.status === "rejected" ? "destructive" : "outline"}>
                              {t(`crm.discounts.status.${request.status}`)}
                            </Badge>
                          </TableCell>
                          <TableCell>{request.requestedByUserName || "—"}</TableCell>
                          <TableCell className="text-right">
                            {canApproveCrm && request.status === "requested" ? (
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => approveDiscountMutation.mutate(request.id)}
                                  disabled={approveDiscountMutation.isPending}
                                >
                                  {t("crm.approve")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => rejectDiscountMutation.mutate(request.id)}
                                  disabled={rejectDiscountMutation.isPending}
                                >
                                  {t("crm.reject")}
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {canApproveCrm && pendingDiscounts.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("crm.discounts.pendingCount", { count: pendingDiscounts.length })}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CustomerDetailModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsCustomerModalOpen(false);
          setSelectedCustomer(null);
          window.history.replaceState({}, "", "/crm");
        }}
        customerId={activeCustomer?.id || null}
        customerEmail={activeCustomer?.email || ""}
        customerName={activeCustomer?.name || ""}
        canManageCrm={canManageCrm}
      />
    </div>
  );
}
