import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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

  const orders = overview?.orders || [];
  const tickets = overview?.tickets || [];
  const interactions = overview?.interactions || [];
  const prices = individualPrices?.prices || [];
  const hasIndividualPrices = !!individualPrices?.available;

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
      </DialogContent>
    </Dialog>
  );
}
