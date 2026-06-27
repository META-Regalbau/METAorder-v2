import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Play } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState, useEffect, useMemo } from "react";
import type { CrossSellingRule, AiCrossSellRule, CrossSellStagingBatch, CrossSellStagingRule, CrossSellStagingSuggestion } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AddRuleDialog from "@/components/AddRuleDialog";
import EditRuleDialog from "@/components/EditRuleDialog";
import EditStagingRuleDialog from "@/components/EditStagingRuleDialog";
import ProductAutocomplete from "@/components/ProductAutocomplete";
import BulkExecutionDialog from "@/components/BulkExecutionDialog";
import SortableTableHead from "@/components/SortableTableHead";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useCrossSellProductLabels } from "@/hooks/useCrossSellProductLabels";

type SortDirection = "asc" | "desc";
type RuleSortKey = "name" | "description" | "status" | "conditions";

type CrossSellLearningSettingsPayload = {
  minSupport: number;
  minConfidence: number;
  minLift: number;
  minPairCount: number;
  maxRulesPerProduct: number;
  maxRecommendationsPerProduct: number;
  wCoOcc?: number;
  wEmbed?: number;
  wSignal?: number;
  wRule?: number;
  signalAlpha?: number;
  signalBeta?: number;
  useLlmRerank?: boolean;
};

type AiInsightRow = {
  id: string;
  insightType: string;
  title: string;
  description?: string;
  data?: { pairs?: Array<Record<string, unknown>> };
  generatedAt: string;
};

type StagingApplyPreviewResponse = {
  batchId: string;
  summary: { activeSuggestions: number; operations: number };
  operations: Array<{
    sourceProductNumber: string;
    sourceProductName: string | null;
    category: string | null;
    shopwareGroupName: string;
    targets: Array<{ productNumber: string; name: string | null }>;
    targetsTotalBeforeCap: number;
    targetsApplied: number;
  }>;
};

export default function CrossSellingRulesPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<CrossSellingRule | null>(null);
  const [editingStagingRule, setEditingStagingRule] = useState<CrossSellStagingRule | null>(null);
  const [showBulkDialog, setShowBulkDialog] = useState(false);
  const [activeTab, setActiveTab] = useState("manual");
  const [sortKey, setSortKey] = useState<RuleSortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [stagingEdits, setStagingEdits] = useState<Record<string, string>>({});
  const [stagingGroupFilter, setStagingGroupFilter] = useState("");
  const [targetedSourceProduct, setTargetedSourceProduct] = useState("");
  const [previewData, setPreviewData] = useState<{
    ruleId: string;
    ruleName: string;
    preview: Array<{
      sourceProductNumber: string;
      sourceProductName: string;
      targetProducts: Array<{
        productNumber: string;
        productName: string;
      }>;
      count: number;
    }>;
    suggestionsCount: number;
  } | null>(null);
  const [lastAiRunStats, setLastAiRunStats] = useState<{
    processedOrders?: number;
    rulesCount?: number;
    recommendationsCount?: number;
    insightsCount?: number;
  } | null>(null);
  const [lastStagingStats, setLastStagingStats] = useState<{
    suggestionsCount: number;
    updatedAt: string;
    productsWithSuggestions?: number;
    productsWithoutSuggestions?: number;
  } | null>(null);
  const [showShopwareApplyPreview, setShowShopwareApplyPreview] = useState(false);

  // Fetch all rules
  const { data, isLoading } = useQuery<{ rules: CrossSellingRule[] }>({
    queryKey: ["/api/cross-selling-rules"],
  });

  const rules = data?.rules || [];

  const { data: aiData, isLoading: aiLoading } = useQuery<{ rules: AiCrossSellRule[] }>({
    queryKey: ["/api/ai/cross-selling/rules"],
    queryFn: async () => {
      const response = await fetch("/api/ai/cross-selling/rules", { credentials: "include" });
      // #endregion
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`${response.status}: ${text || response.statusText}`);
      }
      return response.json();
    },
  });

  const aiRules: AiCrossSellRule[] = aiData?.rules ?? [];

  const { data: crossSellLearningSettings } = useQuery<CrossSellLearningSettingsPayload>({
    queryKey: ["/api/cross-selling/learning-settings"],
    queryFn: async () => {
      const response = await fetch("/api/cross-selling/learning-settings", { credentials: "include" });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`${response.status}: ${text || response.statusText}`);
      }
      return response.json();
    },
    enabled: activeTab === "ai",
  });

  const [learningDraft, setLearningDraft] = useState<CrossSellLearningSettingsPayload | null>(null);
  useEffect(() => {
    if (crossSellLearningSettings) {
      setLearningDraft(crossSellLearningSettings);
    }
  }, [crossSellLearningSettings]);

  const { data: crossSellInsightsData } = useQuery<{ insights: AiInsightRow[] }>({
    queryKey: ["/api/ai/cross-selling/insights"],
    queryFn: async () => {
      const response = await fetch("/api/ai/cross-selling/insights", { credentials: "include" });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`${response.status}: ${text || response.statusText}`);
      }
      return response.json();
    },
    enabled: activeTab === "ai",
  });

  const saveLearningSettingsMutation = useMutation({
    mutationFn: async (body: CrossSellLearningSettingsPayload) => {
      return apiRequest("PUT", "/api/cross-selling/learning-settings", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/learning-settings"] });
      toast({
        title: t("rules.learningSaved", "Einstellungen gespeichert"),
      });
    },
    onError: (error: any) => {
      toast({
        title: t("errors.updateFailed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { data: stagingData, isLoading: stagingLoading } = useQuery<{
    batch: CrossSellStagingBatch | null;
    rules: CrossSellStagingRule[];
    suggestions: CrossSellStagingSuggestion[];
  }>({
    queryKey: ["/api/cross-selling/staging"],
  });

  const stagingBatch = stagingData?.batch ?? null;
  const stagingRules = stagingData?.rules ?? [];
  const stagingSuggestions = stagingData?.suggestions ?? [];
  const stagingSuggestionPreview = stagingSuggestions.slice(0, 200);
  const stagingSuggestionsTruncated = stagingSuggestions.length > stagingSuggestionPreview.length;
  const stagingGroups = Array.from(
    stagingSuggestions.reduce((acc, suggestion) => {
      if (suggestion.active !== 1 || !suggestion.sourceProductNumber || !suggestion.targetProductNumber) {
        return acc;
      }
      if (!acc.has(suggestion.sourceProductNumber)) {
        acc.set(suggestion.sourceProductNumber, []);
      }
      acc.get(suggestion.sourceProductNumber)!.push(suggestion.targetProductNumber);
      return acc;
    }, new Map<string, string[]>())
  )
    .map(([sourceProductNumber, targets]) => ({
      sourceProductNumber,
      targets: Array.from(new Set(targets)),
    }))
    .sort((a, b) => a.sourceProductNumber.localeCompare(b.sourceProductNumber));

  const filteredStagingGroups = stagingGroupFilter.trim().length === 0
    ? stagingGroups
    : stagingGroups.filter((group) =>
        group.sourceProductNumber.toLowerCase().includes(stagingGroupFilter.trim().toLowerCase())
      );

  const productNumbersForLabels = useMemo(() => {
    const s = new Set<string>();
    if (activeTab === "ai") {
      for (const r of aiRules) {
        if (r.sourceProductNumber) s.add(r.sourceProductNumber);
        if (r.targetProductNumber) s.add(r.targetProductNumber);
      }
      for (const ins of crossSellInsightsData?.insights ?? []) {
        if (ins.insightType !== "top_quality_pairs" && ins.insightType !== "low_quality_pairs") continue;
        for (const row of ins.data?.pairs ?? []) {
          const src = row.source as string | undefined;
          const tgt = row.target as string | undefined;
          if (src) s.add(src);
          if (tgt) s.add(tgt);
        }
      }
    }
    if (activeTab === "staging") {
      for (const su of stagingSuggestions) {
        if (su.sourceProductNumber) s.add(su.sourceProductNumber);
        if (su.targetProductNumber) s.add(su.targetProductNumber);
      }
      for (const r of stagingRules) {
        if (r.sourceProductNumber) s.add(r.sourceProductNumber);
        if (r.targetProductNumber) s.add(r.targetProductNumber);
      }
      for (const g of stagingGroups) {
        s.add(g.sourceProductNumber);
        for (const t of g.targets) s.add(t);
      }
    }
    return Array.from(s).filter(Boolean).slice(0, 400);
  }, [activeTab, aiRules, crossSellInsightsData?.insights, stagingSuggestions, stagingRules, stagingGroups]);

  const { productName } = useCrossSellProductLabels(
    productNumbersForLabels,
    productNumbersForLabels.length > 0 && (activeTab === "ai" || activeTab === "staging"),
  );

  const { data: applyPreviewData, isFetching: applyPreviewLoading } = useQuery<StagingApplyPreviewResponse>({
    queryKey: ["/api/cross-selling/staging/apply-preview", stagingBatch?.id],
    queryFn: async () => {
      const q = stagingBatch?.id ? `?batchId=${encodeURIComponent(stagingBatch.id)}` : "";
      const res = await apiRequest("GET", `/api/cross-selling/staging/apply-preview${q}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Preview failed");
      }
      return res.json();
    },
    enabled: showShopwareApplyPreview && !!stagingBatch,
  });

  const getGroupCountVariant = (count: number) => {
    if (count >= 10) return "bg-red-100 text-red-800";
    if (count >= 5) return "bg-yellow-100 text-yellow-800";
    return "bg-green-100 text-green-800";
  };

  const handleSortChange = (key: RuleSortKey) => {
    setSortKey((current) => {
      if (current === key) {
        setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDirection("asc");
      return key;
    });
  };

  const sortedRules = [...rules].sort((a, b) => {
    const direction = sortDirection === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name":
        return a.name.localeCompare(b.name) * direction;
      case "description":
        return (a.description || "").localeCompare(b.description || "") * direction;
      case "status":
        return (Number(a.active) - Number(b.active)) * direction;
      case "conditions":
        return (a.sourceConditions.length - b.sourceConditions.length) * direction;
      default:
        return 0;
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      return apiRequest("DELETE", `/api/cross-selling-rules/${ruleId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling-rules"] });
      toast({
        title: t('rules.deleted'),
        description: t('rules.deletedDescription'),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('rules.deleteError'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Toggle active mutation
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      return apiRequest("PUT", `/api/cross-selling-rules/${id}`, { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling-rules"] });
    },
    onError: (error: any) => {
      toast({
        title: t('errors.updateFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateStagingRuleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest("PUT", `/api/cross-selling/staging/rules/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/staging"] });
    },
    onError: (error: any) => {
      toast({
        title: t("errors.updateFailed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateStagingSuggestionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest("PUT", `/api/cross-selling/staging/suggestions/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/staging"] });
    },
    onError: (error: any) => {
      toast({
        title: t("errors.updateFailed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const regenerateStagingMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/cross-selling/staging/regenerate", {});
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to regenerate staging suggestions");
      }
      return response.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/staging"] });
      setLastStagingStats({
        suggestionsCount: result?.suggestionsCount ?? 0,
        updatedAt: new Date().toISOString(),
        productsWithSuggestions: result?.productsWithSuggestions,
        productsWithoutSuggestions: result?.productsWithoutSuggestions,
      });
      toast({
        title: t("rules.stagingRegenerated", "Vorschlaege neu berechnet"),
        description: t("rules.stagingRegeneratedCount", "{{count}} Vorschlaege", {
          count: result?.suggestionsCount ?? 0,
        }),
      });
    },
    onError: (error: any) => {
      toast({
        title: t("rules.stagingRegenerateError", "Neuberechnung fehlgeschlagen"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const applyStagingMutation = useMutation({
    mutationFn: async () => {
      const body = stagingBatch?.id ? { batchId: stagingBatch.id } : {};
      const response = await apiRequest("POST", "/api/cross-selling/staging/apply", body);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to apply staging");
      }
      return response.json();
    },
    onSuccess: () => {
      setShowShopwareApplyPreview(false);
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/staging"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/staging/apply-preview"] });
      toast({
        title: t("rules.stagingApplied", "Staging in Shopware uebertragen"),
      });
    },
    onError: (error: any) => {
      toast({
        title: t("rules.stagingApplyError", "Uebertragen fehlgeschlagen"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const targetedSuggestionsMutation = useMutation({
    mutationFn: async () => {
      const productNumber = targetedSourceProduct.trim();
      if (!productNumber) {
        throw new Error(t("rules.stagingTargetRequired", "Bitte einen Ausgangsartikel wählen"));
      }
      const response = await apiRequest("POST", "/api/cross-selling/staging/targeted", {
        productNumber,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to generate targeted suggestions");
      }
      return response.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/staging"] });
      toast({
        title: t("rules.stagingTargetedSuccess", "Gezielte Vorschlaege erstellt"),
        description: t("rules.stagingTargetedCount", "{{count}} Vorschlaege", {
          count: result?.suggestionsCount ?? 0,
        }),
      });
    },
    onError: (error: any) => {
      toast({
        title: t("rules.stagingTargetedError", "Gezielte Vorschlaege fehlgeschlagen"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const executeRuleMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      const response = await apiRequest("POST", "/api/cross-selling/staging/execute-rule", { ruleId });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to execute rule");
      }
      return response.json();
    },
    onSuccess: (result: any, ruleId: string) => {
      const rule = rules.find(r => r.id === ruleId);
      setPreviewData({
        ruleId,
        ruleName: rule?.name ?? "Regel",
        preview: result.preview || [],
        suggestionsCount: result.suggestionsCount ?? 0,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/staging"] });
      toast({
        title: t("rules.executeSuccess", "Regel ausgeführt"),
        description: t("rules.executeCount", "{{count}} Vorschläge generiert", {
          count: result.suggestionsCount ?? 0,
        }),
      });
    },
    onError: (error: any) => {
      toast({
        title: t("rules.executeError", "Ausführung fehlgeschlagen"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDelete = (ruleId: string) => {
    if (window.confirm(t('rules.deleteConfirm'))) {
      deleteMutation.mutate(ruleId);
    }
  };

  const handleToggleActive = (rule: CrossSellingRule) => {
    toggleActiveMutation.mutate({ id: rule.id, active: !rule.active });
  };

  const handleStagingRuleToggle = (rule: CrossSellStagingRule) => {
    updateStagingRuleMutation.mutate({ id: rule.id, data: { active: rule.active ? 0 : 1 } });
  };

  const handleStagingSuggestionToggle = (suggestion: CrossSellStagingSuggestion) => {
    updateStagingSuggestionMutation.mutate({
      id: suggestion.id,
      data: { active: suggestion.active ? 0 : 1 },
    });
  };

  const handleStagingSuggestionEdit = (id: string, value: string) => {
    setStagingEdits((current) => ({ ...current, [id]: value }));
  };

  const handleStagingSuggestionSave = (suggestion: CrossSellStagingSuggestion) => {
    const nextValue = (stagingEdits[suggestion.id] || "").trim();
    if (!nextValue || nextValue === suggestion.targetProductNumber) {
      return;
    }
    updateStagingSuggestionMutation.mutate({
      id: suggestion.id,
      data: { targetProductNumber: nextValue },
    });
  };

  const runLearningMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/cross-selling/run", {});
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to run learning job");
      }
      return response.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/cross-selling/rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/cross-selling/insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/staging"] });
      setLastAiRunStats({
        processedOrders: result?.processedOrders,
        rulesCount: result?.rulesCount,
        recommendationsCount: result?.recommendationsCount,
        insightsCount: result?.insightsCount,
      });
      toast({
        title: t('rules.aiRunSuccess', 'AI-Lernlauf gestartet'),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('rules.aiRunError', 'AI-Lernlauf fehlgeschlagen'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="w-full p-6 space-y-6" data-testid="page-rules">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">
            {t('rules.title')}
          </h1>
          <p className="text-muted-foreground">{t('rules.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowBulkDialog(true)}
            disabled={rules.length === 0}
            data-testid="button-execute-bulk"
          >
            <Play className="h-4 w-4 mr-2" />
            {t('rules.executeBulk')}
          </Button>
          <Button
            onClick={() => setShowAddDialog(true)}
            data-testid="button-add-rule"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('rules.createNew')}
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="manual">{t('rules.manualTab', 'Manuelle Regeln')}</TabsTrigger>
          <TabsTrigger value="ai">{t('rules.aiTab', 'AI-Regeln')}</TabsTrigger>
          <TabsTrigger value="staging">{t('rules.stagingTab', 'Staging')}</TabsTrigger>
        </TabsList>

        <TabsContent value="manual">
          <Card className="p-6">
            {isLoading ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">{t('common.loading')}</p>
              </div>
            ) : rules.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-lg font-medium">{t('rules.noRules')}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('rules.noRulesDescription')}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead
                      label={t('rules.name')}
                      sortKey="name"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSortChange}
                    />
                    <SortableTableHead
                      label={t('rules.description')}
                      sortKey="description"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSortChange}
                    />
                    <SortableTableHead
                      label={t('rules.status')}
                      sortKey="status"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSortChange}
                    />
                    <SortableTableHead
                      label={t('rules.conditions')}
                      sortKey="conditions"
                      activeKey={sortKey}
                      direction={sortDirection}
                      onSort={handleSortChange}
                    />
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRules.map((rule) => (
                    <TableRow key={rule.id} data-testid={`row-rule-${rule.id}`}>
                      <TableCell className="font-medium" data-testid={`text-name-${rule.id}`}>
                        {rule.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground" data-testid={`text-description-${rule.id}`}>
                        {rule.description || '-'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={rule.active ? "default" : "secondary"}
                          data-testid={`badge-status-${rule.id}`}
                        >
                          {rule.active ? t('rules.active') : t('rules.inactive')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {rule.sourceConditions.length} {t('rules.source')} →{' '}
                        {rule.targetCriteria.length} {t('rules.target')}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleActive(rule)}
                            data-testid={`button-toggle-${rule.id}`}
                            title={rule.active ? t('rules.deactivate') : t('rules.activate')}
                          >
                            {rule.active ? (
                              <ToggleRight className="h-4 w-4" />
                            ) : (
                              <ToggleLeft className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => executeRuleMutation.mutate(rule.id)}
                            disabled={!rule.active || executeRuleMutation.isPending}
                            data-testid={`button-execute-${rule.id}`}
                            title={t('rules.executeRule', 'Regel ausführen')}
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingRule(rule)}
                            data-testid={`button-edit-${rule.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(rule.id)}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-${rule.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="ai">
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{t('rules.aiTitle', 'AI-Regeln')}</h2>
                <p className="text-sm text-muted-foreground">{t('rules.aiSubtitle', 'Automatisch aus Bestellungen gelernt')}</p>
              </div>
              <Button
                variant="outline"
                onClick={() => runLearningMutation.mutate()}
                disabled={runLearningMutation.isPending}
                data-testid="button-run-ai-learning"
              >
                {t('rules.aiRun', 'AI-Regeln neu berechnen')}
              </Button>
            </div>
            {lastAiRunStats && (
              <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                <span>
                  {t("rules.aiRunOrders", "Bestellungen")}: {lastAiRunStats.processedOrders ?? 0}
                </span>
                <span>
                  {t("rules.aiRunRules", "Regeln")}: {lastAiRunStats.rulesCount ?? 0}
                </span>
                <span>
                  {t("rules.aiRunRecommendations", "Empfehlungen")}: {lastAiRunStats.recommendationsCount ?? 0}
                </span>
                <span>
                  {t("rules.aiRunInsights", "Insights")}: {lastAiRunStats.insightsCount ?? 0}
                </span>
              </div>
            )}

            {learningDraft && (
              <Card className="p-4 border-dashed">
                <h3 className="text-sm font-semibold mb-3">
                  {t("rules.hybridRankerTitle", "Hybrid-Ranker & GPT-Re-Rank")}
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                  {t(
                    "rules.hybridRankerHint",
                    "Gewichte fuer Korb-Korrelation, Semantik (Embeddings), Nutzerfunnel und Regel-Prioritaet. GPT-Re-Rank nur fuer interaktive Vorschlaege (nicht Bulk/Staging-Scan)."
                  )}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {(
                    [
                      ["wCoOcc", t("rules.weightCoOcc", "Korb w")],
                      ["wEmbed", t("rules.weightEmbed", "Embed w")],
                      ["wSignal", t("rules.weightSignal", "Funnel w")],
                      ["wRule", t("rules.weightRule", "Regel w")],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key} className="space-y-1">
                      <Label className="text-xs">{label}</Label>
                      <Input
                        type="number"
                        step="0.05"
                        min={0}
                        max={1}
                        value={learningDraft[key] ?? ""}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setLearningDraft((d) =>
                            d ? { ...d, [key]: Number.isFinite(v) ? v : undefined } : d,
                          );
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("rules.signalAlpha", "Signal Alpha")}</Label>
                    <Input
                      type="number"
                      step="0.5"
                      min={0.01}
                      value={learningDraft.signalAlpha ?? ""}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setLearningDraft((d) =>
                          d ? { ...d, signalAlpha: Number.isFinite(v) ? v : undefined } : d,
                        );
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("rules.signalBeta", "Signal Beta")}</Label>
                    <Input
                      type="number"
                      step="1"
                      min={0.01}
                      value={learningDraft.signalBeta ?? ""}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setLearningDraft((d) =>
                          d ? { ...d, signalBeta: Number.isFinite(v) ? v : undefined } : d,
                        );
                      }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div>
                    <Label htmlFor="use-llm-rerank" className="text-sm font-medium">
                      {t("rules.useLlmRerank", "GPT-4o Re-Rank (Vorschlaege)")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t("rules.useLlmRerankHint", "Kann per Umgebungsvariable CROSS_SELL_LLM_RERANK_ENABLED global aus sein.")}
                    </p>
                  </div>
                  <Switch
                    id="use-llm-rerank"
                    checked={learningDraft.useLlmRerank !== false}
                    onCheckedChange={(checked) =>
                      setLearningDraft((d) => (d ? { ...d, useLlmRerank: checked } : d))
                    }
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={saveLearningSettingsMutation.isPending}
                  onClick={() => learningDraft && saveLearningSettingsMutation.mutate(learningDraft)}
                >
                  {t("rules.saveLearningSettings", "Lern-Einstellungen speichern")}
                </Button>
              </Card>
            )}

            {crossSellInsightsData?.insights && crossSellInsightsData.insights.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {(["top_quality_pairs", "low_quality_pairs"] as const).map((insightType) => {
                  const insight = crossSellInsightsData.insights.find((i) => i.insightType === insightType);
                  const pairs = insight?.data?.pairs ?? [];
                  if (!insight) return null;
                  return (
                    <Card key={insightType} className="p-4">
                      <h3 className="text-sm font-semibold mb-1">{insight.title}</h3>
                      {insight.description && (
                        <p className="text-xs text-muted-foreground mb-2">{insight.description}</p>
                      )}
                      {pairs.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t("rules.noInsightData", "Noch keine Daten")}</p>
                      ) : (
                        <div className="max-h-48 overflow-y-auto text-xs space-y-2">
                          {pairs.slice(0, 12).map((row, idx) => {
                            const src = (row.source as string) ?? "?";
                            const tgt = (row.target as string) ?? "?";
                            return (
                              <div key={idx} className="border-b border-border/40 pb-1">
                                <div className="font-mono text-[11px]">
                                  {src} → {tgt}
                                </div>
                                <div className="text-muted-foreground leading-snug">
                                  {productName(src) && <span>{productName(src)}</span>}
                                  {productName(src) && productName(tgt) && <span> · </span>}
                                  {productName(tgt) && <span>{productName(tgt)}</span>}
                                </div>
                                {typeof row.addRatePct === "number" && (
                                  <div className="text-muted-foreground mt-0.5">
                                    ({row.addRatePct}% / {String(row.impressions ?? "")} Imp.)
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}

            {aiLoading ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">{t('common.loading')}</p>
              </div>
            ) : aiRules.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-lg font-medium">{t('rules.aiNoRules', 'Keine AI-Regeln gefunden')}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('rules.aiSource', 'Quelle')}</TableHead>
                    <TableHead>{t("rules.productName", "Bezeichnung")}</TableHead>
                    <TableHead>{t('rules.aiTarget', 'Ziel')}</TableHead>
                    <TableHead>{t("rules.productNameTarget", "Bezeichnung Ziel")}</TableHead>
                    <TableHead>{t('rules.aiSupport', 'Support')}</TableHead>
                    <TableHead>{t('rules.aiConfidence', 'Confidence')}</TableHead>
                    <TableHead>{t('rules.aiLift', 'Lift')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aiRules.map((rule) => (
                    <TableRow key={rule.id} data-testid={`row-ai-rule-${rule.id}`}>
                      <TableCell className="font-mono text-xs">{rule.sourceProductNumber}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px]">
                        {productName(rule.sourceProductNumber) || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{rule.targetProductNumber}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px]">
                        {productName(rule.targetProductNumber) || "—"}
                      </TableCell>
                      <TableCell>{(rule.support * 100).toFixed(1)}%</TableCell>
                      <TableCell>{(rule.confidence * 100).toFixed(1)}%</TableCell>
                      <TableCell>{rule.lift.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="staging">
          <Card className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{t("rules.stagingTitle", "Staging")}</h2>
                <p className="text-sm text-muted-foreground">
                  {stagingBatch
                    ? t(
                        "rules.stagingLatest",
                        `Letzter Snapshot: ${new Date(stagingBatch.createdAt).toLocaleString()}`
                      )
                    : t("rules.stagingNone", "Kein Staging vorhanden. Bitte AI-Regeln neu berechnen.")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t(
                    "rules.stagingApplyHint",
                    "Beim Übertragen wird je Ausgangsartikel genau eine bestehende Cross-Selling-Gruppe aktualisiert."
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => regenerateStagingMutation.mutate()}
                  disabled={!stagingBatch || regenerateStagingMutation.isPending}
                >
                  {t("rules.stagingRegenerate", "Vorschlaege neu berechnen")}
                </Button>
                <Button
                  onClick={() => setShowShopwareApplyPreview(true)}
                  disabled={!stagingBatch || applyStagingMutation.isPending}
                >
                  {t("rules.stagingApplyPreview", "Vorschau vor Uebertragung")}
                </Button>
              </div>
            </div>
            {lastStagingStats && (
              <div className="text-sm text-muted-foreground">
                {t("rules.stagingLastRun", "Letzte Berechnung")}: {new Date(lastStagingStats.updatedAt).toLocaleString()} ·{" "}
                {t("rules.stagingLastRunCount", "{{count}} Vorschlaege", {
                  count: lastStagingStats.suggestionsCount,
                })}
                {typeof lastStagingStats.productsWithSuggestions === "number" &&
                  typeof lastStagingStats.productsWithoutSuggestions === "number" && (
                    <>
                      {" "}
                      · {t("rules.stagingCoverage", "Mit Vorschlaegen")}: {lastStagingStats.productsWithSuggestions} /{" "}
                      {t("rules.stagingCoverageMissing", "Ohne")}: {lastStagingStats.productsWithoutSuggestions}
                    </>
                  )}
              </div>
            )}

            {stagingLoading ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">{t("common.loading")}</p>
              </div>
            ) : !stagingBatch ? (
              <div className="text-center py-12">
                <p className="text-lg font-medium">{t("rules.stagingNone", "Kein Staging vorhanden")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("rules.stagingNoneHint", "Starte den AI-Lernlauf, um ein Staging zu erzeugen.")}
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <h3 className="text-base font-semibold">
                    {t("rules.stagingTargetedTitle", "Gezielte Vorschlaege")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "rules.stagingTargetedHint",
                      "Waehle einen Ausgangsartikel und erstelle Vorschlaege aus der kombinierten Regelbasis."
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-[360px]">
                      <ProductAutocomplete
                        value={targetedSourceProduct}
                        onChange={setTargetedSourceProduct}
                        placeholder={t("rules.stagingTargetSelect", "Ausgangsartikel wählen")}
                      />
                    </div>
                    <Button
                      onClick={() => targetedSuggestionsMutation.mutate()}
                      disabled={targetedSuggestionsMutation.isPending}
                    >
                      {t("rules.stagingTargetRun", "Vorschlaege berechnen")}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold">{t("rules.stagingRules", "Regeln")}</h3>
                    <span className="text-sm text-muted-foreground">
                      {t("rules.stagingRuleCount", "{{count}} Regeln", { count: stagingRules.length })}
                    </span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("rules.name")}</TableHead>
                        <TableHead>{t("rules.type", "Typ")}</TableHead>
                        <TableHead>{t("rules.status")}</TableHead>
                        <TableHead>{t("rules.stagingPair", "Quelle -> Ziel")}</TableHead>
                        <TableHead className="text-right">{t("common.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stagingRules.map((rule) => (
                        <TableRow key={rule.id}>
                          <TableCell className="font-medium">{rule.name}</TableCell>
                          <TableCell>
                            <Badge variant={rule.ruleType === "ai" ? "default" : "secondary"}>
                              {rule.ruleType === "ai" ? "AI" : t("rules.manualTab", "Manuell")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={rule.active ? "default" : "secondary"}>
                              {rule.active ? t("rules.active") : t("rules.inactive")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {rule.sourceProductNumber && rule.targetProductNumber ? (
                              <div className="space-y-1">
                                <div className="font-mono text-xs">
                                  {rule.sourceProductNumber} → {rule.targetProductNumber}
                                </div>
                                <div className="text-xs">
                                  {(productName(rule.sourceProductNumber) || productName(rule.targetProductNumber)) && (
                                    <>
                                      {productName(rule.sourceProductNumber) && (
                                        <span>{productName(rule.sourceProductNumber)}</span>
                                      )}
                                      {productName(rule.sourceProductNumber) &&
                                        productName(rule.targetProductNumber) && <span> · </span>}
                                      {productName(rule.targetProductNumber) && (
                                        <span>{productName(rule.targetProductNumber)}</span>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            ) : (
                              t("rules.stagingDynamic", "Dynamisch")
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleStagingRuleToggle(rule)}
                                title={rule.active ? t("rules.deactivate") : t("rules.activate")}
                              >
                                {rule.active ? (
                                  <ToggleRight className="h-4 w-4" />
                                ) : (
                                  <ToggleLeft className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditingStagingRule(rule)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold">{t("rules.stagingSuggestions", "Vorschlaege")}</h3>
                    <span className="text-sm text-muted-foreground">
                      {t("rules.stagingSuggestionCount", "{{count}} Vorschlaege", {
                        count: stagingSuggestions.length,
                      })}
                    </span>
                  </div>
                  {stagingSuggestionsTruncated && (
                    <p className="text-xs text-muted-foreground">
                      {t("rules.stagingSuggestionLimit", "Anzeige auf 200 Vorschlaege begrenzt")}
                    </p>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("rules.aiSource", "Quelle")}</TableHead>
                        <TableHead>{t("rules.productName", "Bezeichnung")}</TableHead>
                        <TableHead>{t("rules.aiTarget", "Ziel")}</TableHead>
                        <TableHead>{t("rules.status")}</TableHead>
                        <TableHead className="text-right">{t("common.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stagingSuggestionPreview.map((suggestion) => {
                        const currentValue =
                          stagingEdits[suggestion.id] ?? suggestion.targetProductNumber;
                        const isDirty =
                          stagingEdits[suggestion.id] !== undefined &&
                          stagingEdits[suggestion.id].trim() !== suggestion.targetProductNumber;
                        return (
                          <TableRow key={suggestion.id}>
                            <TableCell className="font-medium font-mono text-xs">
                              {suggestion.sourceProductNumber}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[220px]">
                              {productName(suggestion.sourceProductNumber) || "—"}
                            </TableCell>
                            <TableCell>
                              <ProductAutocomplete
                                value={currentValue}
                                onChange={(value) => handleStagingSuggestionEdit(suggestion.id, value)}
                                placeholder={t("rules.stagingSelectTarget", "Zielprodukt wählen")}
                              />
                            </TableCell>
                            <TableCell>
                              <Badge variant={suggestion.active ? "default" : "secondary"}>
                                {suggestion.active ? t("rules.active") : t("rules.inactive")}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleStagingSuggestionToggle(suggestion)}
                                  title={
                                    suggestion.active ? t("rules.deactivate") : t("rules.activate")
                                  }
                                >
                                  {suggestion.active ? (
                                    <ToggleRight className="h-4 w-4" />
                                  ) : (
                                    <ToggleLeft className="h-4 w-4" />
                                  )}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleStagingSuggestionSave(suggestion)}
                                  disabled={!isDirty || updateStagingSuggestionMutation.isPending}
                                >
                                  {t("common.save")}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold">
                      {t("rules.stagingGroupsPreview", "Gruppen-Vorschau (Staging)")}
                    </h3>
                    <span className="text-sm text-muted-foreground">
                      {t("rules.stagingGroupCount", "{{count}} Gruppen", {
                        count: filteredStagingGroups.length,
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "rules.stagingGroupsHint",
                      "Zeigt nur aktive Vorschlaege, die in Shopware zusammen angezeigt werden."
                    )}
                  </p>
                  <div className="max-w-xs">
                    <Input
                      value={stagingGroupFilter}
                      onChange={(event) => setStagingGroupFilter(event.target.value)}
                      placeholder={t("rules.stagingGroupFilter", "Nach Ausgangsartikel filtern")}
                    />
                  </div>
                  {filteredStagingGroups.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      {t("rules.stagingGroupsEmpty", "Keine aktiven Gruppen vorhanden")}
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("rules.aiSource", "Quelle")}</TableHead>
                          <TableHead>{t("rules.productName", "Bezeichnung")}</TableHead>
                          <TableHead>{t("rules.aiTarget", "Ziel")}</TableHead>
                          <TableHead className="text-right">{t("common.count", "Anzahl")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredStagingGroups.map((group) => (
                          <TableRow key={group.sourceProductNumber}>
                            <TableCell className="font-medium font-mono text-xs">
                              {group.sourceProductNumber}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[220px]">
                              {productName(group.sourceProductNumber) || "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {group.targets.map((target) => (
                                  <Badge
                                    key={`${group.sourceProductNumber}-${target}`}
                                    variant="secondary"
                                    className="max-w-[280px] whitespace-normal text-left font-normal"
                                    title={productName(target) || target}
                                  >
                                    <span className="font-mono text-[10px] block">{target}</span>
                                    {productName(target) && (
                                      <span className="block text-xs text-muted-foreground truncate">
                                        {productName(target)}
                                      </span>
                                    )}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge className={getGroupCountVariant(group.targets.length)}>
                                {group.targets.length}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <AddRuleDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
      />
      <EditRuleDialog
        rule={editingRule}
        open={!!editingRule}
        onClose={() => setEditingRule(null)}
      />
      <EditStagingRuleDialog
        rule={editingStagingRule}
        open={!!editingStagingRule}
        onClose={() => setEditingStagingRule(null)}
      />
      <BulkExecutionDialog
        open={showBulkDialog}
        onClose={() => setShowBulkDialog(false)}
        rules={rules}
      />
      
      {/* Rule Execution Preview Dialog */}
      <Dialog open={!!previewData} onOpenChange={(open) => !open && setPreviewData(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("rules.previewTitle", "Regel ausgeführt")}: {previewData?.ruleName}
            </DialogTitle>
            <DialogDescription>
              {t("rules.previewDescription", "{{count}} Vorschläge für {{products}} Produkte generiert", {
                count: previewData?.suggestionsCount ?? 0,
                products: previewData?.preview.length ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {previewData && previewData.preview.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("rules.aiSource", "Ausgangsprodukt")}</TableHead>
                    <TableHead>{t("rules.aiTarget", "Vorgeschlagene Produkte")}</TableHead>
                    <TableHead className="text-right">{t("common.count", "Anzahl")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.preview.map((item) => (
                    <TableRow key={item.sourceProductNumber}>
                      <TableCell className="font-medium">
                        <div className="space-y-1">
                          <div>{item.sourceProductNumber}</div>
                          <div className="text-xs text-muted-foreground">{item.sourceProductName}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {item.targetProducts.map((target) => (
                            <Badge 
                              key={target.productNumber} 
                              variant="secondary"
                              title={target.productName}
                            >
                              <span className="font-mono">{target.productNumber}</span>
                              {target.productName && <span className="font-normal opacity-90"> – {target.productName}</span>}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge className={getGroupCountVariant(item.count)}>
                          {item.count}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-8">
                {t("rules.previewEmpty", "Keine Vorschläge generiert")}
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewData(null)}>
              {t("common.close", "Schließen")}
            </Button>
            <Button 
              onClick={() => {
                setPreviewData(null);
                setActiveTab("staging");
              }}
            >
              {t("rules.goToStaging", "Zum Staging wechseln")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showShopwareApplyPreview}
        onOpenChange={(open) => {
          if (!open) setShowShopwareApplyPreview(false);
        }}
      >
        <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t("rules.shopwareApplyPreviewTitle", "Vorschau: Uebertragung nach Shopware")}</DialogTitle>
            <DialogDescription>
              {t(
                "rules.shopwareApplyPreviewDesc",
                "So werden aktive Staging-Vorschlaege gruppiert und je Kategorie als Cross-Selling-Gruppe geschrieben (max. 10 Ziele pro Gruppe wie bei der Uebertragung).",
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
            {applyPreviewLoading && (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            )}
            {!applyPreviewLoading && applyPreviewData && (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("rules.shopwareApplySummary", "{{active}} aktive Vorschlaege → {{ops}} Shopware-Operationen", {
                    active: applyPreviewData.summary.activeSuggestions,
                    ops: applyPreviewData.summary.operations,
                  })}
                </p>
                {applyPreviewData.operations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("rules.shopwareApplyPreviewEmpty", "Keine aktiven Vorschlaege zum Uebertragen.")}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("rules.shopwareGroup", "Shopware-Gruppe")}</TableHead>
                        <TableHead>{t("rules.aiSource", "Ausgangsartikel")}</TableHead>
                        <TableHead>{t("rules.aiTarget", "Zielartikel")}</TableHead>
                        <TableHead className="text-right">{t("rules.shopwareTargetLimit", "Limit")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {applyPreviewData.operations.map((op, idx) => (
                        <TableRow key={`${op.sourceProductNumber}-${op.shopwareGroupName}-${idx}`}>
                          <TableCell className="text-sm font-medium">{op.shopwareGroupName}</TableCell>
                          <TableCell>
                            <div className="font-mono text-xs">{op.sourceProductNumber}</div>
                            <div className="text-sm text-muted-foreground">
                              {op.sourceProductName || "—"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {op.targets.map((tg) => (
                                <div key={tg.productNumber} className="text-sm">
                                  <span className="font-mono text-xs">{tg.productNumber}</span>
                                  {tg.name && (
                                    <span className="text-muted-foreground"> — {tg.name}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                            {op.targetsTotalBeforeCap > op.targetsApplied && (
                              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                                {t(
                                  "rules.shopwareTargetTruncated",
                                  "Hinweis: {{total}} Ziele im Staging, es werden nur {{applied}} uebernommen.",
                                  { total: op.targetsTotalBeforeCap, applied: op.targetsApplied },
                                )}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {op.targetsApplied}/10
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowShopwareApplyPreview(false)}>
              {t("common.cancel", "Abbrechen")}
            </Button>
            <Button
              onClick={() => applyStagingMutation.mutate()}
              disabled={
                applyStagingMutation.isPending ||
                applyPreviewLoading ||
                !applyPreviewData ||
                applyPreviewData.operations.length === 0
              }
            >
              {applyStagingMutation.isPending
                ? t("common.loading")
                : t("rules.stagingApplyConfirm", "Jetzt in Shopware uebertragen")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
