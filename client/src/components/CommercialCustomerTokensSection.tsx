import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Check, Copy, Loader2, Plus, ShieldCheck, Trash2, X } from "lucide-react";

type CustomerToken = {
  id: string;
  shopwareCustomerId: string;
  name: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

type ShopwareCustomer = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
};

const TOKENS_QUERY_KEY = ["/api/settings/commercial-customer-tokens"] as const;

function customerLabel(c: ShopwareCustomer): string {
  const person = [c.firstName, c.lastName].filter(Boolean).join(" ");
  return c.company?.trim() || person || c.email || c.id;
}

export default function CommercialCustomerTokensSection() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ tokens: CustomerToken[] }>({
    queryKey: TOKENS_QUERY_KEY,
  });
  const tokens = data?.tokens ?? [];

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<ShopwareCustomer | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<CustomerToken | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: searchData, isFetching: isSearching } = useQuery<{
    customers: ShopwareCustomer[];
  }>({
    queryKey: [
      "/api/settings/commercial-customer-tokens/customer-search",
      debouncedSearch,
    ],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/settings/commercial-customer-tokens/customer-search?q=${encodeURIComponent(debouncedSearch)}`
      );
      return res.json();
    },
    enabled: debouncedSearch.length >= 2 && !selectedCustomer,
  });

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language || "de", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [i18n.language]
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCustomer) throw new Error(t("settings.customerTokens.selectCustomerFirst"));
      const res = await apiRequest("POST", "/api/settings/commercial-customer-tokens", {
        shopwareCustomerId: selectedCustomer.id,
        name: tokenName.trim() || customerLabel(selectedCustomer),
      });
      return res.json() as Promise<{ id: string; token: string }>;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY });
      setCreatedToken(created.token);
      setCopied(false);
      setSelectedCustomer(null);
      setTokenName("");
      setSearch("");
      toast({ title: t("settings.customerTokens.createdTitle") });
    },
    onError: (e: Error) =>
      toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(
        "DELETE",
        `/api/settings/commercial-customer-tokens/${encodeURIComponent(id)}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY });
      toast({ title: t("settings.customerTokens.revokedTitle") });
    },
    onError: (e: Error) =>
      toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
    onSettled: () => setRevokeTarget(null),
  });

  const handleCopy = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: t("settings.customerTokens.copyFailed"), variant: "destructive" });
    }
  };

  const isRevoked = (token: CustomerToken) => Boolean(token.revokedAt);
  const isExpired = (token: CustomerToken) =>
    Boolean(token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now());

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium uppercase tracking-wide">
            {t("settings.customerTokens.title")}
          </h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.customerTokens.description")}
        </p>

        {createdToken ? (
          <div
            className="mb-4 rounded-lg border border-amber-500 bg-amber-50 p-4 dark:bg-amber-950/30"
            data-testid="customer-token-created"
          >
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-2">
              {t("settings.customerTokens.newTokenWarning")}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-background px-2 py-1 font-mono text-xs">
                {createdToken}
              </code>
              <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setCreatedToken(null)}>
                {t("common.close")}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="space-y-3 mb-4">
          <div>
            <Label className="text-xs">{t("settings.customerTokens.customerLabel")}</Label>
            {selectedCustomer ? (
              <div className="mt-1 flex items-center gap-2 rounded-lg border p-2">
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">
                    {customerLabel(selectedCustomer)}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {selectedCustomer.email}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedCustomer(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <Input
                  className="mt-1"
                  placeholder={t("settings.customerTokens.customerSearchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="input-customer-token-search"
                />
                {debouncedSearch.length >= 2 ? (
                  <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border">
                    {isSearching ? (
                      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("common.loading")}
                      </div>
                    ) : (searchData?.customers?.length ?? 0) === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground">
                        {t("settings.customerTokens.noCustomersFound")}
                      </div>
                    ) : (
                      searchData!.customers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="flex w-full flex-col items-start gap-0.5 border-b p-2 text-left last:border-b-0 hover:bg-muted"
                          onClick={() => setSelectedCustomer(c)}
                        >
                          <span className="text-sm font-medium">{customerLabel(c)}</span>
                          <span className="text-xs text-muted-foreground">{c.email}</span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs">{t("settings.customerTokens.nameLabel")}</Label>
              <Input
                className="mt-1"
                placeholder={t("settings.customerTokens.namePlaceholder")}
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
              />
            </div>
            <Button
              type="button"
              disabled={!selectedCustomer || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              data-testid="button-create-customer-token"
            >
              {createMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {t("settings.customerTokens.create")}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </div>
        ) : tokens.length === 0 ? (
          <div className="py-4 text-sm text-muted-foreground">
            {t("settings.customerTokens.empty")}
          </div>
        ) : (
          <div className="space-y-2">
            {tokens.map((token) => (
              <div
                key={token.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                data-testid={`customer-token-${token.id}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {token.name || t("settings.customerTokens.unnamed")}
                    </span>
                    {isRevoked(token) ? (
                      <Badge variant="destructive">
                        {t("settings.customerTokens.statusRevoked")}
                      </Badge>
                    ) : isExpired(token) ? (
                      <Badge variant="secondary">
                        {t("settings.customerTokens.statusExpired")}
                      </Badge>
                    ) : (
                      <Badge variant="outline">{t("settings.customerTokens.statusActive")}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("settings.customerTokens.createdAt", {
                      date: dateFormatter.format(new Date(token.createdAt)),
                    })}
                    {token.lastUsedAt
                      ? ` · ${t("settings.customerTokens.lastUsedAt", {
                          date: dateFormatter.format(new Date(token.lastUsedAt)),
                        })}`
                      : ` · ${t("settings.customerTokens.neverUsed")}`}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground break-all">
                    {token.shopwareCustomerId}
                  </div>
                </div>
                {!isRevoked(token) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setRevokeTarget(token)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t("settings.customerTokens.revoke")}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-2">
          {t("settings.customerTokens.usage.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.customerTokens.usage.description")}
        </p>
        <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-xs">
          GET /api/public/commercial/orders/&lt;
          {t("settings.customerTokens.usage.documentNumber")}&gt;
        </code>
        <code className="mt-2 block break-all rounded bg-muted px-2 py-1 font-mono text-xs">
          Authorization: Bearer &lt;{t("settings.customerTokens.usage.yourToken")}&gt;
        </code>
      </Card>

      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.customerTokens.revokeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.customerTokens.revokeConfirm", {
                name: revokeTarget?.name || t("settings.customerTokens.unnamed"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={revokeMutation.isPending}
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
            >
              {revokeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("settings.customerTokens.revoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
