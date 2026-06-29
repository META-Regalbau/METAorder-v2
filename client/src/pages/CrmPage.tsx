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
  hasIndividualPrice?: boolean;
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
  const [onlyPossibleExisting, setOnlyPossibleExisting] = useState(false);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

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

  const { data: possibleExistingIndex, isLoading: possibleExistingLoading } = useQuery<{
    configured: boolean;
    customerCount: number;
    companies: Record<string, string | null>;
  }>({
    queryKey: ["/api/crm/customers/possible-existing-index"],
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
  const hasIndividualPrice = (customer: CrmCustomer) =>
    customer.hasIndividualPrice ?? individualPriceEmails.has((customer.email || "").toLowerCase());

  const individualPricesInView = useMemo(
    () => customers.filter((customer) => hasIndividualPrice(customer)).length,
    [customers, individualPriceEmails]
  );

  // Muss identisch zur Server-Normalisierung in /possible-existing-index sein.
  const normalizeCompany = (value?: string | null) =>
    (value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b(gmbh|ag|kg|ohg|e\.?\s?k\.?|mbh|co\.?|kgaa|ug|gbr|ltd|inc|gesellschaft|und|&)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const possibleExistingCompanies = useMemo(
    () => possibleExistingIndex?.companies || {},
    [possibleExistingIndex]
  );
  const getPossibleExistingNumber = (company?: string | null): string | null | undefined => {
    const key = normalizeCompany(company);
    if (key.length < 3) return undefined;
    return key in possibleExistingCompanies ? possibleExistingCompanies[key] : undefined;
  };
  const isPossibleExisting = (company?: string | null) => getPossibleExistingNumber(company) !== undefined;

  const filteredCustomers = useMemo(() => {
    let result = customers;
    if (selectedChannelIds.length > 0) {
      result = result.filter((customer) =>
        (customer.salesChannelIds || []).some((channelId) => selectedChannelIds.includes(channelId))
      );
    }
    if (onlyIndividualPrices) {
      result = result.filter((customer) => hasIndividualPrice(customer));
    }
    if (onlyPossibleExisting) {
      result = result.filter((customer) => isPossibleExisting(customer.company));
    }
    return result;
  }, [customers, onlyIndividualPrices, onlyPossibleExisting, individualPriceEmails, possibleExistingCompanies, selectedChannelIds]);

  const totalCustomers = filteredCustomers.length;
  const totalPages = Math.max(1, Math.ceil(totalCustomers / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = totalCustomers === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, totalCustomers);
  const pagedCustomers = useMemo(
    () => filteredCustomers.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredCustomers, safePage, pageSize]
  );

  // Bei Filter-/Suchwechsel oder geänderter Seitengröße zurück auf Seite 1.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchValue, onlyIndividualPrices, onlyPossibleExisting, selectedChannelIds, pageSize]);

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
                      {individualPricesInView !== individualPricesIndex.customerCount ? (
                        <span className="ml-1 font-normal opacity-80">
                          ({t("crm.customers.individualPricesInView", { count: individualPricesInView })})
                        </span>
                      ) : null}
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
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
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
                <div className="flex items-center gap-2">
                  <Switch
                    id="only-possible-existing"
                    checked={onlyPossibleExisting}
                    onCheckedChange={setOnlyPossibleExisting}
                    disabled={possibleExistingLoading || !possibleExistingIndex?.configured}
                  />
                  <Label htmlFor="only-possible-existing" className="text-sm font-normal text-muted-foreground">
                    {t("crm.customers.onlyPossibleExisting")}
                  </Label>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {customersLoading ? (
                <div className="py-8 text-center text-muted-foreground">{t("common.loading")}</div>
              ) : filteredCustomers.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  {onlyPossibleExisting
                    ? t("crm.customers.emptyPossibleExisting")
                    : onlyIndividualPrices
                      ? t("crm.customers.emptyIndividualPrices")
                      : t("crm.customers.empty")}
                </div>
              ) : (
                <div className="space-y-3">
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
                      {pagedCustomers.map((customer) => (
                        <TableRow key={customer.email} className="hover-elevate">
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{customer.name}</span>
                              {hasIndividualPrice(customer) && (
                                <Badge className="bg-green-600 hover:bg-green-600">
                                  {t("crm.customers.individualPriceBadge")}
                                </Badge>
                              )}
                              {isPossibleExisting(customer.company) && (
                                <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                                  {getPossibleExistingNumber(customer.company)
                                    ? t("crm.customers.possibleExistingBadgeWithNumber", {
                                        number: getPossibleExistingNumber(customer.company),
                                      })
                                    : t("crm.customers.possibleExistingBadge")}
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
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted-foreground">
                    {t("crm.customers.pagination.summary", { from: pageStart, to: pageEnd, total: totalCustomers })}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">{t("crm.customers.pagination.perPage")}</span>
                    {[25, 50, 100].map((size) => (
                      <Button
                        key={size}
                        variant={pageSize === size ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPageSize(size)}
                      >
                        {size}
                      </Button>
                    ))}
                    <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={safePage <= 1}
                      onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    >
                      {t("common.previous")}
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {t("crm.customers.pagination.page", { page: safePage, pages: totalPages })}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={safePage >= totalPages}
                      onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    >
                      {t("common.next")}
                    </Button>
                  </div>
                </div>
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
