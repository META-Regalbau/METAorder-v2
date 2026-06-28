import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import type { Customer, CustomerInteraction, Order, Ticket } from "@shared/schema";

type CustomerOverview = {
  customer: Customer;
  orders: Order[];
  tickets: Ticket[];
  interactions: CustomerInteraction[];
};

type CustomerIndividualPrice = {
  id: string;
  productId: string | null;
  productNumber: string | null;
  productName: string | null;
  from: number | null;
  to: number | null;
  priceNet: number | null;
  pseudoPriceNet: number | null;
  currencyIsoCode: string | null;
  validFrom: string | null;
  validUntil: string | null;
};

type CustomerIndividualPricesResponse = {
  available: boolean;
  total: number;
  prices: CustomerIndividualPrice[];
  resolved: boolean;
  configured: boolean;
  pluginDetected?: boolean;
  customerNumber?: string | null;
};

type CustomerMatchAddress = {
  street?: string;
  zipCode?: string;
  city?: string;
  country?: string;
  company?: string;
  phoneNumber?: string;
};

type CustomerMatchCandidate = {
  customerId: string;
  customerNumber: string | null;
  email: string | null;
  name: string | null;
  company: string | null;
  billingAddress: CustomerMatchAddress | null;
  groupName: string | null;
  isBestandskunde: boolean;
  reasons: string[];
  score: number;
};

type CustomerMatchResponse = {
  configured: boolean;
  self: { customerId: string; customerNumber: string | null } | null;
  matches: CustomerMatchCandidate[];
};

type MergePreview = {
  dryRun: boolean;
  duplicate: { id: string; email: string | null; customerNumber: string | null };
  target: { id: string; email: string | null; customerNumber: string | null };
  ordersTotal: number;
  ordersInScope: number;
  ordersOutOfScope: number;
};

const priceFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

interface CustomerDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string | null;
  customerEmail: string;
  customerName?: string;
  canManageCrm: boolean;
}

export default function CustomerDetailModal({
  isOpen,
  onClose,
  customerId,
  customerEmail,
  customerName,
  canManageCrm,
}: CustomerDetailModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [interactionType, setInteractionType] = useState("note");
  const [interactionSubject, setInteractionSubject] = useState("");
  const [interactionBody, setInteractionBody] = useState("");

  const { data: overview, isLoading } = useQuery<CustomerOverview>({
    queryKey: ["/api/crm/customers", customerId || customerEmail, "overview"],
    queryFn: async () => {
      const resolveCustomerId = async () => {
        if (!customerEmail) {
          return undefined;
        }
        const resolveResponse = await fetch(
          `/api/crm/customers/resolve?email=${encodeURIComponent(customerEmail)}&name=${encodeURIComponent(customerName || "")}`,
          { credentials: "include" }
        );
        if (!resolveResponse.ok) {
          throw new Error(await resolveResponse.text());
        }
        const resolveData = await resolveResponse.json();
        return resolveData.customer?.id as string | undefined;
      };

      let resolvedId: string | null | undefined = customerId;
      if (!resolvedId) {
        resolvedId = await resolveCustomerId();
      }
      if (!resolvedId) {
        throw new Error("Failed to resolve customer");
      }

      let response = await fetch(`/api/crm/customers/${resolvedId}/overview`, { credentials: "include" });
      if (response.status === 404) {
        if (customerEmail) {
          resolvedId = await resolveCustomerId();
          if (!resolvedId) {
            throw new Error("Failed to resolve customer");
          }
          response = await fetch(`/api/crm/customers/${resolvedId}/overview`, { credentials: "include" });
        }
      }
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    enabled: isOpen && (!!customerId || !!customerEmail),
  });

  const createInteractionMutation = useMutation({
    mutationFn: async () => {
      if (!overview?.customer?.id) {
        throw new Error("No customer selected");
      }
      const response = await apiRequest("POST", `/api/crm/customers/${overview.customer.id}/interactions`, {
        interactionType,
        subject: interactionSubject.trim() || undefined,
        body: interactionBody.trim() || undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/customers", customerId || customerEmail, "overview"] });
      setInteractionType("note");
      setInteractionSubject("");
      setInteractionBody("");
      toast({ title: t("crm.interactions.created") });
    },
    onError: (error: Error) => {
      toast({ title: t("crm.interactions.failed"), description: error.message, variant: "destructive" });
    },
  });

  const resolvedCustomerId = overview?.customer?.id ?? null;

  const { data: individualPrices, isLoading: pricesLoading } = useQuery<CustomerIndividualPricesResponse>({
    queryKey: ["/api/crm/customers", resolvedCustomerId, "individual-prices"],
    queryFn: async () => {
      const response = await fetch(`/api/crm/customers/${resolvedCustomerId}/individual-prices`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    enabled: isOpen && !!resolvedCustomerId,
  });

  const { data: matchResult, isLoading: matchLoading } = useQuery<CustomerMatchResponse>({
    queryKey: ["/api/crm/customers", resolvedCustomerId, "match"],
    queryFn: async () => {
      const response = await fetch(`/api/crm/customers/${resolvedCustomerId}/match`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    enabled: isOpen && !!resolvedCustomerId,
  });

  const orders = overview?.orders || [];
  const tickets = overview?.tickets || [];
  const interactions = overview?.interactions || [];
  const prices = individualPrices?.prices || [];
  const hasIndividualPrices = !!individualPrices?.available;

  const [mergeCandidate, setMergeCandidate] = useState<CustomerMatchCandidate | null>(null);
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null);

  const duplicateShopwareCustomerId = matchResult?.self?.customerId ?? null;

  const previewMergeMutation = useMutation({
    mutationFn: async (candidate: CustomerMatchCandidate) => {
      if (!duplicateShopwareCustomerId) {
        throw new Error("no-shop-account");
      }
      const response = await apiRequest("POST", "/api/crm/customers/merge", {
        duplicateShopwareCustomerId,
        targetShopwareCustomerId: candidate.customerId,
        dryRun: true,
      });
      return (await response.json()) as MergePreview;
    },
    onSuccess: (data) => {
      setMergePreview(data);
    },
    onError: (error: Error) => {
      setMergeCandidate(null);
      toast({ title: t("crm.customer.match.merge.failed"), description: error.message, variant: "destructive" });
    },
  });

  const executeMergeMutation = useMutation({
    mutationFn: async (candidate: CustomerMatchCandidate) => {
      if (!duplicateShopwareCustomerId) {
        throw new Error("no-shop-account");
      }
      const response = await apiRequest("POST", "/api/crm/customers/merge", {
        duplicateShopwareCustomerId,
        targetShopwareCustomerId: candidate.customerId,
        dryRun: false,
      });
      return response.json();
    },
    onSuccess: (data: { success: boolean; reassignedCount: number; failures?: Array<{ error: string }> }) => {
      setMergeCandidate(null);
      setMergePreview(null);
      if (data.success) {
        toast({ title: t("crm.customer.match.merge.success", { count: data.reassignedCount }) });
      } else {
        toast({
          title: t("crm.customer.match.merge.partial", { count: data.reassignedCount }),
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/crm/customers", customerId || customerEmail, "overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/customers", resolvedCustomerId, "match"] });
    },
    onError: (error: Error) => {
      toast({ title: t("crm.customer.match.merge.failed"), description: error.message, variant: "destructive" });
    },
  });

  const startMerge = (candidate: CustomerMatchCandidate) => {
    setMergePreview(null);
    setMergeCandidate(candidate);
    previewMergeMutation.mutate(candidate);
  };

  const matchCandidates = matchResult?.matches || [];
  const selfCustomerNumber = matchResult?.self?.customerNumber || null;
  const bestandskundeMatches = matchCandidates.filter((candidate) => candidate.isBestandskunde);
  // Bestandskunden-Kundennummer kommt aus einer Händler-Portal-Gruppe, nicht aus
  // dem eigenen Shopkunden-Datensatz (META B2B DE).
  const existingCustomerNumber =
    bestandskundeMatches.find((candidate) => candidate.customerNumber)?.customerNumber || null;
  const isLikelyExisting = bestandskundeMatches.length > 0;

  const formatMatchAddress = (address: CustomerMatchAddress | null) => {
    if (!address) return null;
    const parts = [
      address.company,
      address.street,
      [address.zipCode, address.city].filter(Boolean).join(" "),
      address.country,
    ].filter((part) => part && part.trim().length > 0);
    return parts.length > 0 ? parts.join(", ") : null;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {overview?.customer?.name || customerName || customerEmail}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("crm.customer.tabs.overview")}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !overview ? (
          <div className="py-10 text-center text-muted-foreground">{t("common.loading")}</div>
        ) : (
          <Tabs defaultValue="overview">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="overview">{t("crm.customer.tabs.overview")}</TabsTrigger>
              <TabsTrigger value="orders">{t("crm.customer.tabs.orders")}</TabsTrigger>
              <TabsTrigger value="tickets">{t("crm.customer.tabs.tickets")}</TabsTrigger>
              <TabsTrigger value="prices">{t("crm.customer.tabs.prices")}</TabsTrigger>
              <TabsTrigger value="interactions">{t("crm.customer.tabs.interactions")}</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="pt-4 space-y-4">
              <Card className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{t("crm.customer.match.title")}</div>
                  {matchLoading ? (
                    <span className="text-xs text-muted-foreground">{t("common.loading")}</span>
                  ) : isLikelyExisting ? (
                    <Badge className="bg-amber-500 hover:bg-amber-500 text-white">
                      {existingCustomerNumber
                        ? t("crm.customer.match.existingWithNumber", { number: existingCustomerNumber })
                        : t("crm.customer.match.existing")}
                    </Badge>
                  ) : (
                    <Badge variant="outline">{t("crm.customer.match.noMatch")}</Badge>
                  )}
                </div>

                {!matchLoading && matchResult?.configured === false ? (
                  <div className="text-xs text-muted-foreground">{t("crm.customer.match.notConfigured")}</div>
                ) : null}

                {!matchLoading && matchCandidates.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">{t("crm.customer.match.candidatesHint")}</div>
                    {matchCandidates.map((candidate) => {
                      const address = formatMatchAddress(candidate.billingAddress);
                      return (
                        <div key={candidate.customerId} className="rounded-md border p-3 text-sm space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {candidate.isBestandskunde ? (
                              <Badge className="bg-amber-500 hover:bg-amber-500 text-white">
                                {t("crm.customer.match.bestandskunde")}
                              </Badge>
                            ) : (
                              <Badge variant="outline">{t("crm.customer.match.shopkunde")}</Badge>
                            )}
                            {candidate.customerNumber ? (
                              <Badge variant="secondary" className="font-mono">
                                {t("crm.customer.match.numberLabel", { number: candidate.customerNumber })}
                              </Badge>
                            ) : (
                              <Badge variant="outline">{t("crm.customer.match.noNumber")}</Badge>
                            )}
                            <span className="font-medium">{candidate.name || candidate.email || "—"}</span>
                          </div>
                          {candidate.groupName ? (
                            <div className="text-xs text-muted-foreground">
                              {t("crm.customer.match.groupLabel", { group: candidate.groupName })}
                            </div>
                          ) : null}
                          {candidate.company ? (
                            <div className="text-muted-foreground">{candidate.company}</div>
                          ) : null}
                          {candidate.email ? (
                            <div className="text-xs text-muted-foreground">{candidate.email}</div>
                          ) : null}
                          {address ? <div className="text-xs text-muted-foreground">{address}</div> : null}
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <div className="flex flex-wrap gap-1">
                              {candidate.reasons.map((reason) => (
                                <Badge key={reason} variant="outline" className="text-[10px]">
                                  {t(`crm.customer.match.reasons.${reason}`)}
                                </Badge>
                              ))}
                            </div>
                            {canManageCrm && candidate.isBestandskunde && candidate.customerNumber ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!duplicateShopwareCustomerId || previewMergeMutation.isPending || executeMergeMutation.isPending}
                                onClick={() => startMerge(candidate)}
                                title={!duplicateShopwareCustomerId ? t("crm.customer.match.merge.noShopAccount") : undefined}
                              >
                                {t("crm.customer.match.merge.action")}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {!matchLoading && matchResult?.configured !== false && matchCandidates.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    {selfCustomerNumber
                      ? t("crm.customer.match.selfOnly", { number: selfCustomerNumber })
                      : t("crm.customer.match.noCandidates")}
                  </div>
                ) : null}
              </Card>

              <Card className="p-4 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{overview.customer.status}</Badge>
                  {overview.customer.tags?.map((tag) => (
                    <Badge key={tag} variant="secondary">{tag}</Badge>
                  ))}
                </div>
                <div className="grid md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">{t("crm.customer.email")}</div>
                    <div className="font-medium">{overview.customer.email}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">{t("crm.customer.phone")}</div>
                    <div className="font-medium">{overview.customer.phone || "—"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">{t("crm.customer.company")}</div>
                    <div className="font-medium">{overview.customer.company || "—"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">{t("crm.customer.lastTouch")}</div>
                    <div className="font-medium">
                      {interactions[0]?.createdAt ? new Date(interactions[0].createdAt).toLocaleString() : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">{t("crm.customer.individualPrices.label")}</div>
                    <div className="font-medium">
                      {pricesLoading ? (
                        <span className="text-muted-foreground">{t("common.loading")}</span>
                      ) : hasIndividualPrices ? (
                        <Badge className="bg-green-600 hover:bg-green-600">
                          {t("crm.customer.individualPrices.yesCount", { count: individualPrices?.total ?? prices.length })}
                        </Badge>
                      ) : (
                        <Badge variant="outline">{t("crm.customer.individualPrices.no")}</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="orders" className="pt-4">
              {orders.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground">{t("crm.customer.noOrders")}</div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>{t("orders.orderNumber")}</TableHead>
                        <TableHead>{t("orders.date")}</TableHead>
                        <TableHead className="text-right">{t("orders.total")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="font-mono">{order.orderNumber}</TableCell>
                          <TableCell>{new Date(order.orderDate).toLocaleDateString()}</TableCell>
                          <TableCell className="text-right">€{order.totalAmount.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="tickets" className="pt-4">
              {tickets.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground">{t("crm.customer.noTickets")}</div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>{t("tickets.ticketNumber")}</TableHead>
                        <TableHead>{t("tickets.subject")}</TableHead>
                        <TableHead>{t("tickets.status")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tickets.map((ticket) => (
                        <TableRow key={ticket.id}>
                          <TableCell className="font-mono">{ticket.ticketNumber}</TableCell>
                          <TableCell>{ticket.title}</TableCell>
                          <TableCell>{t(`tickets.status${ticket.status.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("")}`)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="prices" className="pt-4">
              {pricesLoading ? (
                <div className="py-6 text-center text-muted-foreground">{t("common.loading")}</div>
              ) : !individualPrices?.resolved ? (
                <div className="py-6 text-center text-muted-foreground">
                  {t("crm.customer.individualPrices.notResolved")}
                </div>
              ) : prices.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground">
                  {t("crm.customer.individualPrices.empty")}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    {t("crm.customer.individualPrices.summary", { count: individualPrices?.total ?? prices.length })}
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>{t("crm.customer.individualPrices.product")}</TableHead>
                          <TableHead>{t("crm.customer.individualPrices.productNumber")}</TableHead>
                          <TableHead className="text-right">{t("crm.customer.individualPrices.quantity")}</TableHead>
                          <TableHead className="text-right">{t("crm.customer.individualPrices.priceNet")}</TableHead>
                          <TableHead>{t("crm.customer.individualPrices.validity")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {prices.map((price) => (
                          <TableRow key={price.id}>
                            <TableCell>{price.productName || "—"}</TableCell>
                            <TableCell className="font-mono">{price.productNumber || "—"}</TableCell>
                            <TableCell className="text-right">
                              {price.from != null ? `${price.from}${price.to != null ? `–${price.to}` : "+"}` : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {price.priceNet != null ? priceFormatter.format(price.priceNet) : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {price.validFrom || price.validUntil
                                ? `${price.validFrom ? new Date(price.validFrom).toLocaleDateString() : "—"} – ${price.validUntil ? new Date(price.validUntil).toLocaleDateString() : "—"}`
                                : t("crm.customer.individualPrices.alwaysValid")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="interactions" className="pt-4 space-y-4">
              {canManageCrm && (
                <Card className="p-4 space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <Select value={interactionType} onValueChange={setInteractionType}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("crm.interactions.type")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="note">{t("crm.interactions.types.note")}</SelectItem>
                        <SelectItem value="call">{t("crm.interactions.types.call")}</SelectItem>
                        <SelectItem value="email">{t("crm.interactions.types.email")}</SelectItem>
                        <SelectItem value="meeting">{t("crm.interactions.types.meeting")}</SelectItem>
                        <SelectItem value="other">{t("crm.interactions.types.other")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder={t("crm.interactions.subject")}
                      value={interactionSubject}
                      onChange={(event) => setInteractionSubject(event.target.value)}
                    />
                    <Button
                      onClick={() => createInteractionMutation.mutate()}
                      disabled={createInteractionMutation.isPending || !interactionBody.trim()}
                    >
                      {t("crm.interactions.add")}
                    </Button>
                  </div>
                  <Textarea
                    rows={3}
                    placeholder={t("crm.interactions.body")}
                    value={interactionBody}
                    onChange={(event) => setInteractionBody(event.target.value)}
                  />
                </Card>
              )}

              {interactions.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground">{t("crm.interactions.empty")}</div>
              ) : (
                <div className="space-y-3">
                  {interactions.map((interaction) => (
                    <Card key={interaction.id} className="p-4 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{interaction.interactionType}</Badge>
                        <span>{new Date(interaction.createdAt).toLocaleString()}</span>
                      </div>
                      {interaction.subject && <div className="font-medium">{interaction.subject}</div>}
                      <div className="text-sm text-muted-foreground">{interaction.body || t("crm.interactions.noDetails")}</div>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}

        <AlertDialog
          open={!!mergeCandidate}
          onOpenChange={(open) => {
            if (!open) {
              setMergeCandidate(null);
              setMergePreview(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("crm.customer.match.merge.confirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <div>
                    {t("crm.customer.match.merge.confirmIntro", {
                      number: mergeCandidate?.customerNumber ?? "",
                      name: mergeCandidate?.name || mergeCandidate?.company || mergeCandidate?.email || "",
                    })}
                  </div>
                  {previewMergeMutation.isPending || !mergePreview ? (
                    <div className="text-muted-foreground">{t("common.loading")}</div>
                  ) : (
                    <ul className="list-disc space-y-1 pl-5">
                      <li>{t("crm.customer.match.merge.confirmOrders", { count: mergePreview.ordersInScope })}</li>
                      {mergePreview.ordersOutOfScope > 0 ? (
                        <li className="text-destructive">
                          {t("crm.customer.match.merge.confirmOutOfScope", { count: mergePreview.ordersOutOfScope })}
                        </li>
                      ) : null}
                      <li>{t("crm.customer.match.merge.confirmDeactivate", { email: mergePreview.duplicate.email ?? "" })}</li>
                    </ul>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={executeMergeMutation.isPending}>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={
                  executeMergeMutation.isPending ||
                  previewMergeMutation.isPending ||
                  !mergePreview ||
                  (mergePreview?.ordersOutOfScope ?? 0) > 0
                }
                onClick={(event) => {
                  event.preventDefault();
                  if (mergeCandidate) {
                    executeMergeMutation.mutate(mergeCandidate);
                  }
                }}
              >
                {t("crm.customer.match.merge.confirmAction")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
