import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";

type SemanticResult = {
  sourceType: string;
  sourceId: string;
  title: string;
  content: string;
  metadata?: Record<string, any>;
  distance: number;
  textRank: number;
};

type FaqSource = {
  sourceType: string;
  sourceId: string;
  title: string;
  excerpt: string;
  metadata?: Record<string, any>;
};

type FaqResponse = {
  answer: string | null;
  sources: FaqSource[];
  model?: string;
};

const SOURCE_OPTIONS = [
  { value: "all", labelKey: "semanticSearch.globalFilterAll" },
  { value: "product", labelKey: "semanticSearch.globalFilterProducts" },
  { value: "offer", labelKey: "semanticSearch.globalFilterOffers" },
  { value: "ticket", labelKey: "semanticSearch.globalFilterTickets" },
  { value: "offer_draft", labelKey: "semanticSearch.globalFilterOfferDrafts" },
  { value: "order_draft", labelKey: "semanticSearch.globalFilterOrderDrafts" },
  { value: "ticket_template", labelKey: "semanticSearch.globalFilterTicketTemplates" },
];

function buildResultPath(result: { sourceType: string; metadata?: Record<string, any> }): string | null {
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
  if (result.sourceType === "offer_draft") {
    return "/offer-drafts";
  }
  if (result.sourceType === "order_draft") {
    return "/order-drafts";
  }
  if (result.sourceType === "ticket_template") {
    return "/templates";
  }
  return null;
}

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
  if (trimmed.length <= 160) return trimmed;
  return `${trimmed.slice(0, 157)}...`;
}

function getScore(distance: number): string {
  const score = Math.max(0, 1 - distance);
  return score.toFixed(2);
}

export default function SemanticSearchPage() {
  const { t, i18n } = useTranslation();
  const [location, setLocation] = useLocation();
  const params = useMemo(() => {
    const searchFromLocation = location.includes("?") ? location.split("?")[1] : "";
    const searchFallback = typeof window !== "undefined" ? window.location.search.slice(1) : "";
    return new URLSearchParams(searchFromLocation || searchFallback);
  }, [location]);
  const queryParam = params.get("q") || "";
  const sourceParam = params.get("source") || "all";

  const [queryInput, setQueryInput] = useState(queryParam);
  const [sourceFilter, setSourceFilter] = useState(sourceParam);
  const [faqFeedback, setFaqFeedback] = useState<"helpful" | "unhelpful" | null>(null);
  const [resultFeedback, setResultFeedback] = useState<Record<string, "like" | "dislike">>({});

  const searchQuery = queryParam.trim();

  useEffect(() => {
    setQueryInput(queryParam);
  }, [queryParam]);

  useEffect(() => {
    setSourceFilter(sourceParam);
  }, [sourceParam]);

  useEffect(() => {
    setFaqFeedback(null);
  }, [searchQuery, sourceFilter]);
  const sourceTypes = sourceFilter === "all" ? undefined : [sourceFilter];
  const language = i18n.language?.startsWith("en")
    ? "en"
    : i18n.language?.startsWith("es")
    ? "es"
    : "de";

  const { data, isLoading, error: searchError } = useQuery<{ results: SemanticResult[] }>({
    queryKey: ["/api/semantic/search", searchQuery, sourceFilter],
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/semantic/search", {
        query: searchQuery,
        limit: 50,
        sourceTypes,
      });
      return response.json();
    },
    enabled: Boolean(searchQuery),
  });

  const { data: faqData, isLoading: faqLoading, error: faqError } = useQuery<FaqResponse>({
    queryKey: ["/api/semantic/faq", searchQuery, sourceFilter, language],
    queryFn: async () => {
      const response = await apiRequest("POST", "/api/semantic/faq", {
        query: searchQuery,
        limit: 6,
        sourceTypes,
        language,
      });
      return response.json();
    },
    enabled: Boolean(searchQuery),
  });

  const faqFeedbackMutation = useMutation({
    mutationFn: async (helpful: boolean) => {
      const response = await apiRequest("POST", "/api/semantic/faq/feedback", {
        query: searchQuery,
        helpful,
        sourceIds: faqData?.sources?.map((source) => source.sourceId) || [],
      });
      return response.json();
    },
    onSuccess: (_data, helpful) => {
      setFaqFeedback(helpful ? "helpful" : "unhelpful");
    },
  });

  const searchFeedbackMutation = useMutation({
    mutationFn: async (payload: { query: string; sourceType: string; sourceId: string; action?: string }) => {
      const response = await apiRequest("POST", "/api/semantic/search/feedback", payload);
      return response.json();
    },
  });

  const results = data?.results || [];
  const topResults = results.slice(0, 3);
  const tableResults = results.slice(3);

  const handleResultOpen = (sourceType: string, sourceId: string, target: string | null) => {
    if (!target) return;
    if (searchQuery) {
      searchFeedbackMutation.mutate({
        query: searchQuery,
        sourceType,
        sourceId,
        action: "open",
      });
    }
    setLocation(target);
  };

  const handleResultFeedback = (sourceType: string, sourceId: string, action: "like" | "dislike") => {
    if (!searchQuery) return;
    const key = `${sourceType}:${sourceId}`;
    setResultFeedback((prev) => ({ ...prev, [key]: action }));
    searchFeedbackMutation.mutate({
      query: searchQuery,
      sourceType,
      sourceId,
      action,
    });
  };

  const handleSubmit = () => {
    const trimmed = queryInput.trim();
    if (!trimmed) return;
    const nextParams = new URLSearchParams();
    nextParams.set("q", trimmed);
    if (sourceFilter && sourceFilter !== "all") {
      nextParams.set("source", sourceFilter);
    }
    setLocation(`/search?${nextParams.toString()}`);
  };

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("semanticSearch.globalTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("semanticSearch.globalSubtitle")}</p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder={t("semanticSearch.globalPlaceholder")}
            className="pl-9"
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSubmit();
            }}
          />
        </div>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t("semanticSearch.globalFilterAll")} />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={handleSubmit}>{t("semanticSearch.globalSearch")}</Button>
      </div>

      {!searchQuery && (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">{t("semanticSearch.globalEmpty")}</p>
        </Card>
      )}

      {searchQuery && isLoading && (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">{t("semanticSearch.globalSearching")}</p>
        </Card>
      )}

      {searchQuery && searchError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">{t("semanticSearch.globalError")}</p>
          <p className="text-xs text-muted-foreground">{String(searchError)}</p>
        </Card>
      )}

      {searchQuery && !isLoading && results.length === 0 && (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">{t("semanticSearch.globalNoResults")}</p>
        </Card>
      )}

      {searchQuery && (
        <Card className="p-6 space-y-3">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {t("semanticSearch.faqTitle")}
            </h2>
            <p className="text-xs text-muted-foreground">{t("semanticSearch.faqSubtitle")}</p>
          </div>
          {faqLoading && (
            <p className="text-sm text-muted-foreground">{t("semanticSearch.faqLoading")}</p>
          )}
          {!faqLoading && faqError && (
            <p className="text-sm text-destructive">{t("semanticSearch.faqError")}</p>
          )}
          {!faqLoading && !faqData?.answer && (
            <p className="text-sm text-muted-foreground">{t("semanticSearch.faqNoAnswer")}</p>
          )}
          {!faqLoading && faqData?.answer && (
            <div className="space-y-3">
              <div className="text-sm leading-relaxed">{faqData.answer}</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={faqFeedback === "helpful" ? "default" : "outline"}
                  onClick={() => faqFeedbackMutation.mutate(true)}
                  disabled={faqFeedbackMutation.isPending || faqFeedback === "helpful"}
                >
                  {t("semanticSearch.faqHelpful")}
                </Button>
                <Button
                  size="sm"
                  variant={faqFeedback === "unhelpful" ? "default" : "outline"}
                  onClick={() => faqFeedbackMutation.mutate(false)}
                  disabled={faqFeedbackMutation.isPending || faqFeedback === "unhelpful"}
                >
                  {t("semanticSearch.faqUnhelpful")}
                </Button>
              </div>
            </div>
          )}
          {!faqLoading && faqData?.sources?.length ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                {t("semanticSearch.faqSources")}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {faqData.sources.map((source) => {
                  const target = buildResultPath({
                    sourceType: source.sourceType,
                    metadata: source.metadata,
                  });
                  return (
                    <Card key={`${source.sourceType}-${source.sourceId}`} className="p-3">
                      <div className="text-sm font-medium">{source.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {t(`semanticSearch.source.${source.sourceType}`, { defaultValue: source.sourceType })}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{source.excerpt}</div>
                      {target && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          onClick={() => handleResultOpen(source.sourceType, source.sourceId, target)}
                        >
                          {t("semanticSearch.globalOpen")}
                        </Button>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>
          ) : null}
        </Card>
      )}

      {topResults.length > 0 && (
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-3">
            {t("semanticSearch.globalTopResults")}
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {topResults.map((result) => {
              const target = buildResultPath(result);
              return (
                <Card key={`${result.sourceType}-${result.sourceId}`} className="flex flex-col">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">{result.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground space-y-2 flex-1">
                    <div className="flex items-center justify-between">
                      <span>{t(`semanticSearch.source.${result.sourceType}`, { defaultValue: result.sourceType })}</span>
                      <span>{t("semanticSearch.globalScore")}: {getScore(result.distance)}</span>
                    </div>
                    <div>{getSecondaryText(result)}</div>
                    <div>{getSnippet(result.content)}</div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={resultFeedback[`${result.sourceType}:${result.sourceId}`] === "like" ? "default" : "outline"}
                        onClick={() => handleResultFeedback(result.sourceType, result.sourceId, "like")}
                      >
                        {t("semanticSearch.feedbackHelpful")}
                      </Button>
                      <Button
                        size="sm"
                        variant={resultFeedback[`${result.sourceType}:${result.sourceId}`] === "dislike" ? "default" : "outline"}
                        onClick={() => handleResultFeedback(result.sourceType, result.sourceId, "dislike")}
                      >
                        {t("semanticSearch.feedbackNotHelpful")}
                      </Button>
                    </div>
                  </CardContent>
                  <CardContent className="pt-0">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!target}
                      onClick={() => handleResultOpen(result.sourceType, result.sourceId, target)}
                    >
                      {t("semanticSearch.globalOpen")}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {tableResults.length > 0 && (
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-3">
            {t("semanticSearch.globalAllResults")}
          </h2>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("semanticSearch.globalTitleLabel")}</TableHead>
                  <TableHead>{t("semanticSearch.globalSource")}</TableHead>
                  <TableHead>{t("semanticSearch.globalScore")}</TableHead>
                  <TableHead>{t("semanticSearch.globalFeedback")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableResults.map((result) => {
                  const target = buildResultPath(result);
                  const feedbackKey = `${result.sourceType}:${result.sourceId}`;
                  return (
                    <TableRow
                      key={`${result.sourceType}-${result.sourceId}`}
                      className={target ? "cursor-pointer" : ""}
                      onClick={() => handleResultOpen(result.sourceType, result.sourceId, target)}
                    >
                      <TableCell className="font-medium">
                        <div>{result.title}</div>
                        <div className="text-xs text-muted-foreground">{getSecondaryText(result)}</div>
                      </TableCell>
                      <TableCell>
                        {t(`semanticSearch.source.${result.sourceType}`, { defaultValue: result.sourceType })}
                      </TableCell>
                      <TableCell>{getScore(result.distance)}</TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant={resultFeedback[feedbackKey] === "like" ? "default" : "outline"}
                            onClick={() => handleResultFeedback(result.sourceType, result.sourceId, "like")}
                          >
                            {t("semanticSearch.feedbackHelpful")}
                          </Button>
                          <Button
                            size="sm"
                            variant={resultFeedback[feedbackKey] === "dislike" ? "default" : "outline"}
                            onClick={() => handleResultFeedback(result.sourceType, result.sourceId, "dislike")}
                          >
                            {t("semanticSearch.feedbackNotHelpful")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
