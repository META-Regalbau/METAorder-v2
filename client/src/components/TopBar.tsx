import { User, LogOut, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import ThemeToggle from "./ThemeToggle";
import LanguageSwitcher from "./LanguageSwitcher";
import { NotificationBell } from "./NotificationBell";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TopBarProps {
  userRole: "employee" | "admin";
  username: string;
  onLogout: () => void;
}

type TenantInfo = {
  id: string;
  name: string;
};

type SemanticResult = {
  sourceType: string;
  sourceId: string;
  title: string;
  content: string;
  metadata?: Record<string, any>;
  distance: number;
  textRank: number;
};

function getSecondaryText(result: SemanticResult): string {
  if (result.sourceType === "product") {
    return result.metadata?.productNumber || "";
  }
  if (result.sourceType === "offer") {
    return result.metadata?.offerNumber || "";
  }
  if (result.sourceType === "ticket") {
    return result.metadata?.ticketNumber || "";
  }
  return result.metadata?.customerName || "";
}

function getSnippet(content: string): string {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 120) return trimmed;
  return `${trimmed.slice(0, 117)}...`;
}

function getScore(distance: number): string {
  const score = Math.max(0, 1 - distance);
  return score.toFixed(2);
}

export default function TopBar({ userRole, username, onLogout }: TopBarProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SemanticResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const { data: tenantData } = useQuery<{
    tenants: TenantInfo[];
    activeTenantId: string | null;
  }>({
    queryKey: ["/api/tenants"],
    retry: false,
  });

  useEffect(() => {
    if (tenantData) {
      setSelectedTenantId(tenantData.activeTenantId || "");
    }
  }, [tenantData]);

  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1] ?? "");
    const queryParam = params.get("q");
    const searchParam = params.get("search");
    const nextValue = queryParam ?? searchParam;
    if (nextValue !== null) {
      setGlobalSearch(nextValue);
    }
  }, [location]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!searchContainerRef.current) return;
      if (!searchContainerRef.current.contains(event.target as Node)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!showSearchResults) {
      setIsSearching(false);
      return;
    }
    const query = globalSearch.trim();
    if (!query) {
      setSearchResults(null);
      setSearchError(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    setSearchError(null);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await apiRequest(
          "POST",
          "/api/semantic/search",
          { query, limit: 6 },
          { signal: controller.signal }
        );
        const data = await response.json();
        setSearchResults(data.results || []);
      } catch (error) {
        if ((error as any)?.name !== "AbortError") {
          console.error("Global search failed:", error);
          setSearchError(String(error));
        }
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [globalSearch, showSearchResults]);
  
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/logout", {});
      
      if (!response.ok) {
        throw new Error("Logout failed");
      }
      
      return response.json();
    },
    onSuccess: () => {
      // Cookie is cleared by backend, no localStorage cleanup needed
      
      // Clear auth query data to trigger immediate redirect to login
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.clear();
      onLogout();
      toast({
        title: t("auth.logout"),
        description: t("auth.logoutSuccess"),
      });
    },
    onError: () => {
      toast({
        title: t("errors.failed"),
        description: t("auth.logoutFailed"),
        variant: "destructive",
      });
    },
  });

  const searchFeedbackMutation = useMutation({
    mutationFn: async (payload: { query: string; sourceType: string; sourceId: string; action?: string }) => {
      const response = await apiRequest("POST", "/api/semantic/search/feedback", payload);
      return response.json();
    },
  });
  
  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const saveTenantSelectionMutation = useMutation({
    mutationFn: async (tenantId: string | null) => {
      const response = await apiRequest("POST", "/api/tenants/select", { tenantId });
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
    onError: (error: any) => {
      toast({
        title: t("settings.tenants.saveError"),
        description: error?.message || t("settings.tenants.saveErrorDesc"),
        variant: "destructive",
      });
    },
  });

  const tenants = tenantData?.tenants || [];
  const showTenantSelect = tenants.length > 0;
  
  const handleGlobalSearch = () => {
    const trimmed = globalSearch.trim();
    if (!trimmed) {
      return;
    }
    setShowSearchResults(false);
    setLocation(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  const handleResultNavigate = (result: SemanticResult, path: string) => {
    setShowSearchResults(false);
    const query = globalSearch.trim();
    if (query) {
      searchFeedbackMutation.mutate({
        query,
        sourceType: result.sourceType,
        sourceId: result.sourceId,
        action: "open",
      });
    }
    setLocation(path);
  };

  const hasResults = Boolean(searchResults && searchResults.length > 0);

  const getResultPath = (result: { sourceType: string; metadata?: Record<string, any> }) => {
    if (result.sourceType === "product") {
      const number = result.metadata?.productNumber;
      return number ? `/products?search=${encodeURIComponent(number)}` : "/products";
    }
    if (result.sourceType === "offer") {
      const offerNumber = result.metadata?.offerNumber;
      return offerNumber ? `/offers?search=${encodeURIComponent(offerNumber)}` : "/offers";
    }
    if (result.sourceType === "ticket") {
      const ticketNumber = result.metadata?.ticketNumber;
      return ticketNumber ? `/tickets?search=${encodeURIComponent(ticketNumber)}` : "/tickets";
    }
    if (result.sourceType === "offer_draft") return "/offer-drafts";
    if (result.sourceType === "order_draft") return "/order-drafts";
    if (result.sourceType === "ticket_template") return "/templates";
    return null;
  };

  return (
    <header className="h-16 border-b bg-card flex items-center justify-between px-6 gap-4 sticky top-0 z-50">
      <div className="flex items-center gap-4">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
        <h1 className="text-xl font-semibold">{t('nav.appTitle')}</h1>
      </div>

      <div className="flex-1 flex justify-center">
        <div className="relative w-full max-w-xl" ref={searchContainerRef}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            value={globalSearch}
            onChange={(event) => setGlobalSearch(event.target.value)}
            onFocus={() => setShowSearchResults(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleGlobalSearch();
              }
              if (event.key === "Escape") {
                setShowSearchResults(false);
              }
            }}
            placeholder={t("globalSearch.placeholder")}
            className="pl-9"
            data-testid="input-global-search"
          />
          {showSearchResults && globalSearch.trim() && (
            <div className="absolute left-0 right-0 top-full mt-2 rounded-lg border bg-card shadow-lg z-50">
              <div className="max-h-[420px] overflow-y-auto p-2">
                {isSearching && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    {t("globalSearch.searching")}
                  </div>
                )}
                {!isSearching && searchError && (
                  <div className="px-3 py-2 text-sm text-destructive">
                    {t("globalSearch.error")}
                  </div>
                )}
                {!isSearching && !searchError && !hasResults && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    {t("globalSearch.noResults")}
                  </div>
                )}
                {!isSearching && !searchError && hasResults && (
                  <div className="space-y-2">
                    {searchResults?.map((result) => {
                      const target = getResultPath(result);
                      return (
                        <button
                          key={`${result.sourceType}-${result.sourceId}`}
                          type="button"
                          onClick={() => target && handleResultNavigate(result, target)}
                          className="w-full text-left rounded-md border px-3 py-2 hover:bg-muted/60 transition"
                          data-testid={`global-search-result-${result.sourceType}-${result.sourceId}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium">{result.title}</div>
                            <div className="text-xs text-muted-foreground">{getScore(result.distance)}</div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {t(`semanticSearch.source.${result.sourceType}`, { defaultValue: result.sourceType })}
                            {getSecondaryText(result) ? ` · ${getSecondaryText(result)}` : ""}
                          </div>
                          <div className="text-xs text-muted-foreground">{getSnippet(result.content)}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {showTenantSelect && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("settings.tenants.selectLabel")}
            </span>
            <Select
              value={selectedTenantId || ""}
              onValueChange={(value) => {
                setSelectedTenantId(value);
                saveTenantSelectionMutation.mutate(value || null);
              }}
            >
              <SelectTrigger className="h-8 w-44" data-testid="select-tenant-topbar">
                <SelectValue placeholder={t("settings.tenants.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((tenant) => (
                  <SelectItem key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <LanguageSwitcher />
        <NotificationBell />
        <ThemeToggle />
        <Badge variant={userRole === "admin" ? "default" : "secondary"} data-testid="badge-user-role">
          {t(`roles.${userRole}`)}
        </Badge>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2" data-testid="button-user-menu">
              <User className="h-4 w-4" />
              <span className="text-sm font-medium" data-testid="text-username">{username}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setLocation("/profile")}>
              {t("nav.profile")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleLogout}
              disabled={logoutMutation.isPending}
              data-testid="button-logout"
            >
              <LogOut className="mr-2 h-4 w-4" />
              {t("auth.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
