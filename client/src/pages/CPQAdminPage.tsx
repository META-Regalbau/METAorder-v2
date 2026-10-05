import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Settings2, BookOpen, Link2, History, AlertTriangle, BarChart3, TrendingDown, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import CpqProductSelector, { type SelectedProduct } from "@/components/cpq/CpqProductSelector";
import CpqRelationshipGraph from "@/components/cpq/CpqRelationshipGraph";
import CpqTableView from "@/components/cpq/CpqTableView";
import CpqCompatibilityMatrix from "@/components/cpq/CpqCompatibilityMatrix";
import CpqRuleConditionEditor from "@/components/cpq/CpqRuleConditionEditor";
import CpqComponentSidebar from "@/components/cpq/CpqComponentSidebar";
import CpqDetailPanel from "@/components/cpq/CpqDetailPanel";

import { useTranslation, Trans } from "react-i18next";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";

type CpqSystem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type CpqRule = {
  id: string;
  systemId: string;
  name: string;
  type: string;
  priority: number;
  status: string;
  message: string | null;
  version: number;
  condition?: object | null;
  action?: object | null;
};

type CpqDiscountLevel = {
  id: string;
  name: string;
  color: string;
  discountMin: string | number;
  discountMax: string | number;
  approvalType: string;
  messageTemplate: string | null;
  justificationRequired?: boolean;
  status: string;
};

type CpqComponentType = {
  id: string;
  systemId: string;
  name: string;
  role: string;
  required: boolean;
  sortOrder: number;
};

type CpqProductMapping = {
  id: string;
  shopwareProductId: string;
  shopwareProductNumber: string;
  systemId: string;
  componentTypeId: string;
  status: string;
  productName?: string | null;
  productDetails?: {
    height?: number | null;
    depth?: number | null;
    loadCapacity?: number | null;
    price?: number | null;
  } | null;
};

export default function CPQAdminPage() {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  // Werte aus der Datenbank fuer Abzeichen beschriften; Unbekanntes bleibt roh sichtbar
  const label = (map: Record<string, string>, value: string | null | undefined) => (value ? map[value] ?? value : "");
  const statusLabels: Record<string, string> = {
    active: t("cpq.admin.status.active"),
    inactive: t("cpq.admin.status.inactive"),
    draft: t("cpq.admin.status.draft"),
    archived: t("cpq.admin.status.archived"),
  };
  const ruleTypeLabels: Record<string, string> = {
    compatibility: t("cpq.admin.rules.types.compatibility"),
    physical: t("cpq.admin.rules.types.physical"),
    configuration: t("cpq.admin.rules.types.configuration"),
    business: t("cpq.admin.rules.types.business"),
  };
  const roleLabels: Record<string, string> = {
    frame: t("cpq.admin.componentTypes.roles.frame"),
    beam: t("cpq.admin.componentTypes.roles.beam"),
    shelf: t("cpq.admin.componentTypes.roles.shelf"),
    connector: t("cpq.admin.componentTypes.roles.connector"),
    accessory: t("cpq.admin.componentTypes.roles.accessory"),
  };
  const approvalTypeLabels: Record<string, string> = {
    none: t("cpq.admin.discountLevels.approvalTypes.none"),
    department_lead: t("cpq.admin.discountLevels.approvalTypes.departmentLead"),
    management: t("cpq.admin.discountLevels.approvalTypes.management"),
    blocked: t("cpq.admin.discountLevels.approvalTypes.blocked"),
  };
  const approvalStatusLabels: Record<string, string> = {
    pending: t("cpq.admin.approvalStatus.pending"),
    approved: t("cpq.admin.approvalStatus.approved"),
    rejected: t("cpq.admin.approvalStatus.rejected"),
  };
  const { toast } = useToast();
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  const [showCreateSystem, setShowCreateSystem] = useState(false);
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [showCreateDiscountLevel, setShowCreateDiscountLevel] = useState(false);
  const [editingDiscountLevel, setEditingDiscountLevel] = useState<CpqDiscountLevel | null>(null);
  const [discountLevelForm, setDiscountLevelForm] = useState({
    name: "", color: "#22c55e", discountMin: 0, discountMax: 10,
    messageTemplate: "", approvalType: "none", justificationRequired: false,
  });
  const [graphSelectedNodeId, setGraphSelectedNodeId] = useState<string | null>(null);
  const [graphSelectedNodeType, setGraphSelectedNodeType] = useState<"system" | "component" | "mapping" | null>(null);
  const [canvasView, setCanvasView] = useState<"graph" | "table" | "matrix">("graph");
  const [showCreateMapping, setShowCreateMapping] = useState(false);
  const [showCreateComponentType, setShowCreateComponentType] = useState(false);
  const [editingRule, setEditingRule] = useState<CpqRule | null>(null);
  const [ruleEditorMode, setRuleEditorMode] = useState<"guided" | "expert">("guided");
  const [editRuleType, setEditRuleType] = useState("compatibility");
  const [ruleExpertJson, setRuleExpertJson] = useState("");
  const [editRuleCondition, setEditRuleCondition] = useState<object | null>(null);
  const [editRuleAction, setEditRuleAction] = useState<object | null>(null);
  const [createRuleCondition, setCreateRuleCondition] = useState<object | null>(null);
  const [createRuleAction, setCreateRuleAction] = useState<object | null>(null);
  const [showRuleImpact, setShowRuleImpact] = useState<CpqRule | null>(null);
  const [ruleImpactData, setRuleImpactData] = useState<{ configurationsAffected: number; message: string } | null>(null);
  const [showRuleVersions, setShowRuleVersions] = useState<CpqRule | null>(null);
  const [ruleVersions, setRuleVersions] = useState<Array<{ version: number; changedBy?: string | null; changedAt?: string }>>([]);
  const [showRulePreview, setShowRulePreview] = useState<CpqRule | null>(null);
  const [rulePreviewData, setRulePreviewData] = useState<{
    ruleName: string;
    totalTested: number;
    matchCount: number;
    sampleMatches: Array<Record<string, unknown>>;
    source?: "saved_configurations" | "mapping_attributes";
  } | null>(null);
  const [activeTab, setActiveTab] = useState("systems");
  const [reportFrom, setReportFrom] = useState(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [reportTo, setReportTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [newRuleType, setNewRuleType] = useState("compatibility");
  const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null);
  const [newComponentTypeName, setNewComponentTypeName] = useState("");
  const [newComponentTypeRole, setNewComponentTypeRole] = useState("accessory");
  const [newMappingComponentTypeId, setNewMappingComponentTypeId] = useState("");

  const { data: systems = [], isLoading: systemsLoading } = useQuery<CpqSystem[]>({
    queryKey: ["/api/cpq/systems"],
  });

  const { data: componentsData, isLoading: componentsLoading } = useQuery<{
    componentTypes: CpqComponentType[];
    mappings: CpqProductMapping[];
  }>({
    queryKey: ["/api/cpq/systems", selectedSystemId, "components"],
    queryFn: async () => {
      if (!selectedSystemId) return { componentTypes: [], mappings: [] };
      const res = await fetch(`/api/cpq/systems/${selectedSystemId}/components`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch components");
      return res.json();
    },
    enabled: !!selectedSystemId,
  });

  const { data: rules = [], isLoading: rulesLoading } = useQuery<CpqRule[]>({
    queryKey: ["/api/cpq/admin/rules", selectedSystemId],
    queryFn: async () => {
      if (!selectedSystemId) return [];
      const res = await fetch(`/api/cpq/admin/rules?system_id=${selectedSystemId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch rules");
      return res.json();
    },
    enabled: !!selectedSystemId && (activeTab === "rules" || activeTab === "graph"),
  });

  const { data: adminDiscountLevels = [], isLoading: discountLevelsLoading } = useQuery<CpqDiscountLevel[]>({
    queryKey: ["/api/cpq/admin/discount-levels"],
    queryFn: async () => {
      const res = await fetch("/api/cpq/admin/discount-levels", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch discount levels");
      return res.json();
    },
    enabled: activeTab === "discount-levels" || activeTab === "reporting",
  });

  const { data: discountOverview, isLoading: overviewLoading } = useQuery<{
    from: string;
    to: string;
    totalEntries: number;
    totalRevenueLoss: number;
    byLevel: Record<string, { count: number; totalRevenueLoss: number }>;
    entries: Array<{
      id: string;
      offerId: string;
      userId?: string;
      discountPercent?: string | number;
      revenueLoss?: string | number;
      approvalStatus?: string;
      createdAt?: string;
    }>;
  }>({
    queryKey: ["/api/cpq/reporting/discount-overview", reportFrom, reportTo],
    queryFn: async () => {
      const params = new URLSearchParams({ from: reportFrom, to: reportTo });
      const res = await fetch(`/api/cpq/reporting/discount-overview?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch discount overview");
      return res.json();
    },
    enabled: activeTab === "reporting",
  });

  const createSystemMutation = useMutation({
    mutationFn: async (data: { name: string; slug: string; description?: string }) => {
      const res = await apiRequest("POST", "/api/cpq/systems", data);
      if (!res.ok) throw new Error("Failed to create system");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cpq/systems"] });
      setShowCreateSystem(false);
      toast({ title: t("cpq.admin.toast.systemCreated"), description: t("cpq.admin.toast.systemCreatedDescription") });
    },
    onError: (e: Error) => toast({ title: t("cpq.admin.toast.error"), description: e.message, variant: "destructive" }),
  });

  const updateRuleMutation = useMutation({
    mutationFn: async (data: { id: string; name?: string; type?: string; priority?: number; condition?: object; action?: object; message?: string; status?: string }) => {
      const { id, ...payload } = data;
      const res = await apiRequest("PUT", `/api/cpq/admin/rules/${id}`, payload);
      if (!res.ok) throw new Error("Failed to update rule");
      return res.json();
    },
    onSuccess: () => {
      if (selectedSystemId) queryClient.invalidateQueries({ queryKey: ["/api/cpq/admin/rules", selectedSystemId] });
      setEditingRule(null);
      toast({ title: t("cpq.admin.toast.ruleUpdated"), description: t("cpq.admin.toast.ruleUpdatedDescription") });
    },
    onError: (e: Error) => toast({ title: t("cpq.admin.toast.error"), description: e.message, variant: "destructive" }),
  });

  const createRuleMutation = useMutation({
    mutationFn: async (data: { systemId: string; name: string; type: string; priority?: number; condition?: object; action?: object; message?: string }) => {
      const res = await apiRequest("POST", "/api/cpq/admin/rules", data);
      if (!res.ok) throw new Error("Failed to create rule");
      return res.json();
    },
    onSuccess: () => {
      if (selectedSystemId) queryClient.invalidateQueries({ queryKey: ["/api/cpq/admin/rules", selectedSystemId] });
      setShowCreateRule(false);
      toast({ title: t("cpq.admin.toast.ruleCreated"), description: t("cpq.admin.toast.ruleCreatedDescription") });
    },
    onError: (e: Error) => toast({ title: t("cpq.admin.toast.error"), description: e.message, variant: "destructive" }),
  });

  const rollbackRuleMutation = useMutation({
    mutationFn: async ({ ruleId, version }: { ruleId: string; version: number }) => {
      const res = await apiRequest("POST", `/api/cpq/admin/rules/${ruleId}/rollback/${version}`);
      if (!res.ok) throw new Error("Failed to rollback rule");
      return res.json();
    },
    onSuccess: () => {
      if (selectedSystemId) queryClient.invalidateQueries({ queryKey: ["/api/cpq/admin/rules", selectedSystemId] });
      setShowRuleVersions(null);
      toast({ title: t("cpq.admin.toast.rollbackDone"), description: t("cpq.admin.toast.rollbackDoneDescription") });
    },
    onError: (e: Error) => toast({ title: t("cpq.admin.toast.error"), description: e.message, variant: "destructive" }),
  });

  const createComponentTypeMutation = useMutation({
    mutationFn: async (data: { systemId: string; name: string; role: string; required?: boolean; sortOrder?: number }) => {
      const res = await apiRequest("POST", "/api/cpq/admin/component-types", data);
      if (!res.ok) throw new Error("Failed to create component type");
      return res.json();
    },
    onSuccess: () => {
      if (selectedSystemId) queryClient.invalidateQueries({ queryKey: ["/api/cpq/systems", selectedSystemId, "components"] });
      setShowCreateComponentType(false);
      setNewComponentTypeName("");
      setNewComponentTypeRole("accessory");
      toast({ title: t("cpq.admin.toast.componentTypeCreated"), description: t("cpq.admin.toast.componentTypeCreatedDescription") });
    },
    onError: (e: Error) => toast({ title: t("cpq.admin.toast.error"), description: e.message, variant: "destructive" }),
  });

  const createMappingMutation = useMutation({
    mutationFn: async (data: { shopwareProductId: string; shopwareProductNumber: string; productName?: string; systemId: string; componentTypeId: string }) => {
      const res = await apiRequest("POST", "/api/cpq/admin/mappings", data);
      if (!res.ok) throw new Error("Failed to create mapping");
      return res.json();
    },
    onSuccess: () => {
      if (selectedSystemId) queryClient.invalidateQueries({ queryKey: ["/api/cpq/systems", selectedSystemId, "components"] });
      setShowCreateMapping(false);
      setSelectedProduct(null);
      setNewMappingComponentTypeId("");
      toast({ title: t("cpq.admin.toast.mappingCreated"), description: t("cpq.admin.toast.mappingCreatedDescription") });
    },
    onError: (e: Error) => toast({ title: t("cpq.admin.toast.error"), description: e.message, variant: "destructive" }),
  });

  const createDiscountLevelMutation = useMutation({
    mutationFn: async (data: { name: string; color: string; discountMin?: number; discountMax: number; messageTemplate?: string; approvalType?: string; justificationRequired?: boolean }) => {
      const res = await apiRequest("POST", "/api/cpq/admin/discount-levels", data);
      if (!res.ok) throw new Error("Failed to create discount level");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cpq/admin/discount-levels"] });
      setShowCreateDiscountLevel(false);
      toast({ title: t("cpq.admin.toast.discountLevelCreated"), description: t("cpq.admin.toast.discountLevelCreatedDescription") });
    },
    onError: (e: Error) => toast({ title: t("cpq.admin.toast.error"), description: e.message, variant: "destructive" }),
  });

  const updateDiscountLevelMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<{ name: string; color: string; discountMin: number; discountMax: number; messageTemplate: string; approvalType: string; justificationRequired: boolean }> }) => {
      const res = await apiRequest("PUT", `/api/cpq/admin/discount-levels/${id}`, data);
      if (!res.ok) throw new Error("Failed to update discount level");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cpq/admin/discount-levels"] });
      setEditingDiscountLevel(null);
      toast({ title: t("cpq.admin.toast.discountLevelUpdated"), description: t("cpq.admin.toast.discountLevelUpdatedDescription") });
    },
    onError: (e: Error) => toast({ title: t("cpq.admin.toast.error"), description: e.message, variant: "destructive" }),
  });

  const deleteDiscountLevelMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/cpq/admin/discount-levels/${id}`);
      if (!res.ok) throw new Error("Failed to delete discount level");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cpq/admin/discount-levels"] });
      toast({ title: t("cpq.admin.toast.discountLevelDeleted"), description: t("cpq.admin.toast.discountLevelDeletedDescription") });
    },
    onError: (e: Error) => toast({ title: t("cpq.admin.toast.error"), description: e.message, variant: "destructive" }),
  });

  const componentTypes = componentsData?.componentTypes ?? [];
  const mappings = componentsData?.mappings ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("cpq.admin.title")}</h1>
        <p className="text-muted-foreground">{t("cpq.admin.subtitle")}</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="systems">{t("cpq.admin.tabs.systems")}</TabsTrigger>
          <TabsTrigger value="graph">{t("cpq.admin.tabs.graph")}</TabsTrigger>
          <TabsTrigger value="mappings" disabled={!selectedSystemId}>{t("cpq.admin.tabs.mappings")}</TabsTrigger>
          <TabsTrigger value="rules" disabled={!selectedSystemId}>{t("cpq.admin.tabs.rules")}</TabsTrigger>
          <TabsTrigger value="discount-levels">{t("cpq.admin.tabs.discountLevels")}</TabsTrigger>
          <TabsTrigger value="reporting">{t("cpq.admin.tabs.reporting")}</TabsTrigger>
        </TabsList>

        <TabsContent value="systems" className="space-y-4 mt-4">
          <Card>
            <div className="p-4 flex justify-between items-center border-b">
              <h2 className="font-semibold">{t("cpq.admin.systems.title")}</h2>
              <Button onClick={() => setShowCreateSystem(true)}>
                <Plus className="h-4 w-4 mr-2" />
                {t("cpq.admin.systems.newSystem")}
              </Button>
            </div>
            {systemsLoading ? (
              <div className="p-4"><Skeleton className="h-24 w-full" /></div>
            ) : systems.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {t("cpq.admin.systems.empty")}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("cpq.admin.common.name")}</TableHead>
                    <TableHead>{t("cpq.admin.systems.slug")}</TableHead>
                    <TableHead>{t("cpq.admin.common.status")}</TableHead>
                    <TableHead>{t("cpq.admin.systems.action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {systems.map((sys) => (
                    <TableRow key={sys.id} className={selectedSystemId === sys.id ? "bg-muted/50" : ""}>
                      <TableCell>{sys.name}</TableCell>
                      <TableCell><code className="text-xs">{sys.slug}</code></TableCell>
                      <TableCell><Badge variant={sys.status === "active" ? "default" : "secondary"}>{label(statusLabels, sys.status)}</Badge></TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => setSelectedSystemId(sys.id)}>
                          {t("cpq.admin.systems.select")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="graph" className="mt-4">
          {!selectedSystemId ? (
            <Card>
              <div className="p-8 text-center space-y-4">
                <h2 className="font-semibold text-lg">{t("cpq.admin.graph.title")}</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  {t("cpq.admin.graph.intro")}
                </p>
                {systems.length > 0 ? (
                  <div className="flex flex-wrap justify-center gap-2 mt-4">
                    {systems.map((sys) => (
                      <Button key={sys.id} variant="outline" onClick={() => setSelectedSystemId(sys.id)}>
                        {t("cpq.admin.graph.selectSystem", { name: sys.name })}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("cpq.admin.graph.noSystems")}</p>
                )}
              </div>
            </Card>
          ) : (
            /* 3-Spalten-Layout: Sidebar | Canvas | Detail */
            <div className="flex h-[calc(100vh-12rem)] min-h-[520px] border rounded-lg overflow-hidden bg-background">
              {/* Sidebar 280px */}
              {componentsLoading ? (
                <div className="w-[280px] shrink-0 border-r p-4">
                  <Skeleton className="h-10 w-full mb-4" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : (
                <CpqComponentSidebar
                  componentTypes={componentTypes}
                  mappings={mappings}
                  selectedNodeId={graphSelectedNodeType === "mapping" ? graphSelectedNodeId : null}
                  onSelectNode={(id) => {
                    setGraphSelectedNodeId(id);
                    setGraphSelectedNodeType("mapping");
                    // Optional: Scroll graph to node
                  }}
                />
              )}

              {/* Main Canvas */}
              <div className="flex-1 flex flex-col min-w-0">
                {/* Canvas Toolbar */}
                <div className="flex items-center gap-2 px-5 py-3 border-b bg-muted/30">
                  <button
                    type="button"
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                      canvasView === "graph"
                        ? "bg-background text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setCanvasView("graph")}
                    data-testid="button-canvas-view-graph"
                  >
                    {t("cpq.admin.graph.viewGraph")}
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                      canvasView === "table"
                        ? "bg-background text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setCanvasView("table")}
                    data-testid="button-canvas-view-table"
                  >
                    {t("cpq.admin.graph.viewTable")}
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                      canvasView === "matrix"
                        ? "bg-background text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setCanvasView("matrix")}
                    data-testid="button-canvas-view-matrix"
                  >
                    {t("cpq.admin.graph.viewMatrix")}
                  </button>
                  <div className="flex-1" />
                  {canvasView === "graph" && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Button variant="outline" size="icon" className="h-7 w-7" title={t("cpq.admin.graph.zoomOut")}>−</Button>
                      <span>100%</span>
                      <Button variant="outline" size="icon" className="h-7 w-7" title={t("cpq.admin.graph.zoomIn")}>+</Button>
                    </div>
                  )}
                </div>

                {/* Canvas: Graph / Tabelle / Matrix */}
                <div className="flex-1 min-h-0">
                  {componentTypes.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                      {t("cpq.admin.graph.noComponentTypes")}
                    </div>
                  ) : canvasView === "graph" ? (
                    <CpqRelationshipGraph
                      system={systems.find((s) => s.id === selectedSystemId)!}
                      componentTypes={componentTypes}
                      mappings={mappings}
                      rules={rules}
                      selectedNodeId={graphSelectedNodeId}
                      onSelectNode={(id, type) => {
                        setGraphSelectedNodeId(id);
                        setGraphSelectedNodeType(type ?? null);
                      }}
                      onSelectRule={() => {}}
                    />
                  ) : canvasView === "table" ? (
                    <CpqTableView
                      system={systems.find((s) => s.id === selectedSystemId)!}
                      componentTypes={componentTypes}
                      mappings={mappings}
                      selectedNodeId={graphSelectedNodeId}
                      onSelectNode={(id, type) => {
                        setGraphSelectedNodeId(id);
                        setGraphSelectedNodeType(type ?? null);
                      }}
                    />
                  ) : (
                    <CpqCompatibilityMatrix
                      system={systems.find((s) => s.id === selectedSystemId)!}
                      componentTypes={componentTypes}
                      mappings={mappings}
                      rules={rules}
                      selectedNodeId={graphSelectedNodeId}
                      onSelectNode={(id, type) => {
                        setGraphSelectedNodeId(id);
                        setGraphSelectedNodeType(type ?? null);
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Detail Panel 420px */}
              <CpqDetailPanel
                selectedNodeId={graphSelectedNodeId}
                selectedNodeType={graphSelectedNodeType}
                systemName={systems.find((s) => s.id === selectedSystemId)?.name ?? t("cpq.admin.common.systemFallback")}
                componentTypes={componentTypes}
                mappings={mappings}
                rules={rules}
                onClose={() => {
                  setGraphSelectedNodeId(null);
                  setGraphSelectedNodeType(null);
                }}
                onEditRule={(id) => {
                  const r = rules.find((x) => x.id === id);
                  if (r) {
                    setEditingRule(r);
                    setRuleEditorMode("guided");
                    setEditRuleType(r.type);
                    setEditRuleCondition(r.condition ?? null);
                    setEditRuleAction(r.action ?? null);
                    setRuleExpertJson(JSON.stringify({ condition: r.condition, action: r.action }, null, 2));
                  }
                }}
                onAddRule={() => setShowCreateRule(true)}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="mappings" className="space-y-4 mt-4">
          {selectedSystemId && (
            <>
              {componentTypes.length > 0 && mappings.length > 0 && (
                <Card>
                  <div className="p-4 border-b">
                    <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{t("cpq.admin.mappings.previewTitle")}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("cpq.admin.mappings.previewSummary", {
                        products: t("cpq.admin.mappings.productCount", { count: mappings.length }),
                        componentTypes: t("cpq.admin.mappings.componentTypeCount", { count: componentTypes.length }),
                      })}
                    </p>
                  </div>
                  <div className="p-4 pt-0">
                    <div className="flex flex-wrap gap-4">
                      {componentTypes.map((ct) => {
                        const ctMappings = mappings.filter((m) => m.componentTypeId === ct.id);
                        if (ctMappings.length === 0) return null;
                        return (
                          <div key={ct.id} className="min-w-0 max-w-[320px]">
                            <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-primary/60" />
                              {ct.name}
                              <span className="text-muted-foreground/80">({ctMappings.length})</span>
                            </p>
                            <ul className="space-y-1 text-sm">
                              {ctMappings.map((m) => (
                                <li key={m.id} className="flex items-baseline gap-2 truncate">
                                  <span className="font-mono text-xs shrink-0">{m.shopwareProductNumber}</span>
                                  {m.productName && <span className="text-muted-foreground truncate">{m.productName}</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </Card>
              )}
              <Card>
                <div className="p-4 flex justify-between items-center border-b">
                  <h2 className="font-semibold">
                    {t("cpq.admin.mappings.title", { name: systems.find((s) => s.id === selectedSystemId)?.name || t("cpq.admin.common.systemFallback") })}
                  </h2>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowCreateComponentType(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      {t("cpq.admin.mappings.addComponentType")}
                    </Button>
                    <Button onClick={() => setShowCreateMapping(true)} disabled={componentTypes.length === 0}>
                      <Link2 className="h-4 w-4 mr-2" />
                      {t("cpq.admin.mappings.newMapping")}
                    </Button>
                  </div>
                </div>
                {componentTypes.length === 0 && (
                  <div className="p-6 border-b bg-muted/30">
                    <p className="text-sm text-muted-foreground mb-3">
                      {t("cpq.admin.mappings.componentTypeFirstHint")}
                    </p>
                    <Button size="sm" onClick={() => setShowCreateComponentType(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      {t("cpq.admin.mappings.createFirstComponentType")}
                    </Button>
                  </div>
                )}
                {componentsLoading ? (
                  <div className="p-4"><Skeleton className="h-24 w-full" /></div>
                ) : mappings.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    {t("cpq.admin.mappings.empty")}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("cpq.admin.mappings.columnProduct")}</TableHead>
                        <TableHead>{t("cpq.admin.mappings.columnShopwareId")}</TableHead>
                        <TableHead>{t("cpq.admin.mappings.componentType")}</TableHead>
                        <TableHead>{t("cpq.admin.common.status")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mappings.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="font-medium">
                            <span className="font-mono">{m.shopwareProductNumber}</span>
                            {m.productName && <span className="text-muted-foreground block text-sm font-normal mt-0.5">{m.productName}</span>}
                          </TableCell>
                          <TableCell><code className="text-xs">{m.shopwareProductId}</code></TableCell>
                          <TableCell>
                            {componentTypes.find((ct) => ct.id === m.componentTypeId)?.name || m.componentTypeId}
                          </TableCell>
                          <TableCell><Badge variant={m.status === "active" ? "default" : "secondary"}>{label(statusLabels, m.status)}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
              {componentTypes.length > 0 && (
                <Card>
                  <div className="p-4 border-b">
                    <h3 className="font-semibold">{t("cpq.admin.componentTypes.title")}</h3>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("cpq.admin.common.name")}</TableHead>
                        <TableHead>{t("cpq.admin.componentTypes.role")}</TableHead>
                        <TableHead>{t("cpq.admin.componentTypes.required")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {componentTypes.map((ct) => (
                        <TableRow key={ct.id}>
                          <TableCell>{ct.name}</TableCell>
                          <TableCell><Badge variant="outline">{label(roleLabels, ct.role)}</Badge></TableCell>
                          <TableCell>{ct.required ? t("cpq.admin.common.yes") : t("cpq.admin.common.no")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="rules" className="space-y-4 mt-4">
          {selectedSystemId && (
            <Card>
              <div className="p-4 flex justify-between items-center border-b">
                <h2 className="font-semibold">{t("cpq.admin.rules.title", { name: systems.find((s) => s.id === selectedSystemId)?.name || t("cpq.admin.common.systemFallback") })}</h2>
                <Button onClick={() => setShowCreateRule(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t("cpq.admin.rules.newRule")}
                </Button>
              </div>
              {rulesLoading ? (
                <div className="p-4"><Skeleton className="h-32 w-full" /></div>
              ) : rules.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  {t("cpq.admin.rules.empty")}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("cpq.admin.common.name")}</TableHead>
                      <TableHead>{t("cpq.admin.rules.type")}</TableHead>
                      <TableHead>{t("cpq.admin.rules.priority")}</TableHead>
                      <TableHead>{t("cpq.admin.common.status")}</TableHead>
                      <TableHead>{t("cpq.admin.rules.version")}</TableHead>
                      <TableHead>{t("cpq.admin.common.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell><Badge variant="outline">{label(ruleTypeLabels, r.type)}</Badge></TableCell>
                        <TableCell>{r.priority}</TableCell>
                        <TableCell><Badge variant={r.status === "active" ? "default" : "secondary"}>{label(statusLabels, r.status)}</Badge></TableCell>
                        <TableCell>{r.version}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => {
                            setEditingRule(r);
                            setRuleEditorMode("guided");
                            setEditRuleType(r.type);
                            setEditRuleCondition(r.condition ?? null);
                            setEditRuleAction(r.action ?? null);
                            setRuleExpertJson(JSON.stringify({ condition: r.condition, action: r.action }, null, 2));
                          }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" title={t("cpq.admin.rules.previewTooltip")} onClick={async () => {
                            setShowRulePreview(r);
                            setRulePreviewData(null);
                            try {
                              const res = await apiRequest("POST", "/api/cpq/admin/rules/preview", { ruleId: r.id });
                              const data = await res.json();
                              setRulePreviewData({
                                ruleName: data.ruleName ?? r.name,
                                totalTested: data.totalTested ?? 0,
                                matchCount: data.matchCount ?? 0,
                                sampleMatches: data.sampleMatches ?? [],
                                source: data.source,
                              });
                            } catch {
                              setRulePreviewData(null);
                            }
                          }}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" title={t("cpq.admin.rules.impactAnalysis")} onClick={async () => {
                            setShowRuleImpact(r);
                            setRuleImpactData(null);
                            try {
                              const res = await apiRequest("POST", `/api/cpq/admin/rules/${r.id}/impact`, {});
                              const data = await res.json();
                              setRuleImpactData({ configurationsAffected: data.configurationsAffected, message: data.message });
                            } catch { setRuleImpactData(null); }
                          }}>
                            <AlertTriangle className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" title={t("cpq.admin.rules.versionHistory")} onClick={async () => {
                            setShowRuleVersions(r);
                            setRuleVersions([]);
                            try {
                              const res = await apiRequest("GET", `/api/cpq/admin/rules/${r.id}/versions`);
                              const data = await res.json();
                              setRuleVersions(data);
                            } catch { setRuleVersions([]); }
                          }}>
                            <History className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          )}
        </TabsContent>

        <TabsContent value="discount-levels" className="space-y-4 mt-4">
          <Card>
            <div className="p-4 flex justify-between items-center border-b">
              <h2 className="font-semibold">{t("cpq.admin.discountLevels.title")}</h2>
              <Button onClick={() => {
                setEditingDiscountLevel(null);
                setDiscountLevelForm({ name: "", color: "#22c55e", discountMin: 0, discountMax: 10, messageTemplate: "", approvalType: "none", justificationRequired: false });
                setShowCreateDiscountLevel(true);
              }}>
                <Plus className="h-4 w-4 mr-2" />
                {t("cpq.admin.discountLevels.newLevel")}
              </Button>
            </div>
            {discountLevelsLoading ? (
              <div className="p-4"><Skeleton className="h-24 w-full" /></div>
            ) : adminDiscountLevels.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {t("cpq.admin.discountLevels.empty")}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("cpq.admin.common.name")}</TableHead>
                    <TableHead>{t("cpq.admin.discountLevels.color")}</TableHead>
                    <TableHead>{t("cpq.admin.common.discountPercent")}</TableHead>
                    <TableHead>{t("cpq.admin.discountLevels.approval")}</TableHead>
                    <TableHead>{t("cpq.admin.common.status")}</TableHead>
                    <TableHead>{t("cpq.admin.common.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adminDiscountLevels.map((dl) => (
                    <TableRow key={dl.id}>
                      <TableCell>{dl.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: dl.color }} />
                          <span className="text-xs text-muted-foreground">{dl.color}</span>
                        </div>
                      </TableCell>
                      <TableCell>{Number(dl.discountMin)} – {Number(dl.discountMax)}%</TableCell>
                      <TableCell><Badge variant="outline">{label(approvalTypeLabels, dl.approvalType)}</Badge></TableCell>
                      <TableCell><Badge variant={dl.status === "active" ? "default" : "secondary"}>{label(statusLabels, dl.status)}</Badge></TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => {
                          setEditingDiscountLevel(dl);
                          setDiscountLevelForm({
                            name: dl.name,
                            color: dl.color || "#22c55e",
                            discountMin: Number(dl.discountMin) || 0,
                            discountMax: Number(dl.discountMax) || 10,
                            messageTemplate: dl.messageTemplate || "",
                            approvalType: dl.approvalType || "none",
                            justificationRequired: dl.justificationRequired ?? false,
                          });
                        }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteDiscountLevelMutation.mutate(dl.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="reporting" className="space-y-4 mt-4">
          <Card>
            <div className="p-4 flex flex-wrap items-end gap-4 border-b">
              <h2 className="font-semibold flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                {t("cpq.admin.reporting.title")}
              </h2>
              <div className="flex items-center gap-2 ml-auto">
                <div>
                  <Label className="text-xs">{t("cpq.admin.reporting.from")}</Label>
                  <Input aria-label={t("cpq.admin.reporting.from")} type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} className="w-36" />
                </div>
                <div>
                  <Label className="text-xs">{t("cpq.admin.reporting.to")}</Label>
                  <Input aria-label={t("cpq.admin.reporting.to")} type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} className="w-36" />
                </div>
              </div>
            </div>
            {overviewLoading ? (
              <div className="p-8"><Skeleton className="h-32 w-full" /></div>
            ) : discountOverview ? (
              <div className="p-4 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-lg border p-4 flex items-center gap-3">
                    <div className="p-2 rounded-full bg-primary/10">
                      <TrendingDown className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("cpq.admin.reporting.totalRevenueLoss")}</p>
                      <p className="text-xl font-semibold">{fmt.currency(Number(discountOverview.totalRevenueLoss))}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border p-4 flex items-center gap-3">
                    <div className="p-2 rounded-full bg-muted">
                      <BarChart3 className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{t("cpq.admin.reporting.entryCount")}</p>
                      <p className="text-xl font-semibold">{discountOverview.totalEntries}</p>
                    </div>
                  </div>
                </div>

                {Object.keys(discountOverview.byLevel).length > 0 && (
                  <div>
                    <h3 className="font-medium mb-2">{t("cpq.admin.reporting.byLevel")}</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("cpq.admin.reporting.level")}</TableHead>
                          <TableHead>{t("cpq.admin.reporting.count")}</TableHead>
                          <TableHead>{t("cpq.admin.reporting.revenueLoss")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(discountOverview.byLevel).map(([levelId, stats]) => {
                          const level = adminDiscountLevels.find((l) => l.id === levelId);
                          return (
                            <TableRow key={levelId}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {level ? (
                                    <>
                                      <div className="w-3 h-3 rounded-full border" style={{ backgroundColor: level.color }} />
                                      {level.name}
                                    </>
                                  ) : (
                                    levelId
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>{stats.count}</TableCell>
                              <TableCell>{fmt.currency(Number(stats.totalRevenueLoss))}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {discountOverview.entries.length > 0 && (
                  <div>
                    <h3 className="font-medium mb-2">{t("cpq.admin.reporting.recentEntries")}</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("cpq.admin.reporting.date")}</TableHead>
                          <TableHead>{t("cpq.admin.reporting.offer")}</TableHead>
                          <TableHead>{t("cpq.admin.common.discountPercent")}</TableHead>
                          <TableHead>{t("cpq.admin.reporting.revenueLoss")}</TableHead>
                          <TableHead>{t("cpq.admin.common.status")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {discountOverview.entries.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell className="text-sm">
                              {e.createdAt ? fmt.dateTime(e.createdAt) : "-"}
                            </TableCell>
                            <TableCell><code className="text-xs">{e.offerId}</code></TableCell>
                            <TableCell>{e.discountPercent != null ? fmt.percentValue(Number(e.discountPercent), 1) : "-"}</TableCell>
                            <TableCell>{fmt.currency(e.revenueLoss != null ? Number(e.revenueLoss) : 0)}</TableCell>
                            <TableCell>
                              <Badge variant={e.approvalStatus === "approved" ? "default" : e.approvalStatus === "rejected" ? "destructive" : "secondary"}>
                                {label(approvalStatusLabels, e.approvalStatus || "pending")}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {discountOverview.totalEntries === 0 && (
                  <p className="text-muted-foreground text-center py-8">{t("cpq.admin.reporting.empty")}</p>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">{t("cpq.admin.reporting.loadError")}</div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create System Dialog */}
      <Dialog open={showCreateSystem} onOpenChange={setShowCreateSystem}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cpq.admin.systems.createTitle")}</DialogTitle>
            <DialogDescription>{t("cpq.admin.systems.createDescription")}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.target as HTMLFormElement;
              const name = (form.elements.namedItem("name") as HTMLInputElement).value;
              const slug = (form.elements.namedItem("slug") as HTMLInputElement).value;
              const description = (form.elements.namedItem("description") as HTMLTextAreaElement).value;
              createSystemMutation.mutate({ name, slug, description: description || undefined });
            }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="name">{t("cpq.admin.common.name")}</Label>
              <Input id="name" name="name" placeholder={t("cpq.admin.systems.namePlaceholder")} required />
            </div>
            <div>
              <Label htmlFor="slug">{t("cpq.admin.systems.slug")}</Label>
              <Input id="slug" name="slug" placeholder="meta-clip" required />
            </div>
            <div>
              <Label htmlFor="description">{t("cpq.admin.systems.descriptionLabel")}</Label>
              <Textarea id="description" name="description" rows={3} placeholder={t("cpq.admin.systems.descriptionPlaceholder")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateSystem(false)}>{t("cpq.admin.common.cancel")}</Button>
              <Button type="submit" disabled={createSystemMutation.isPending}>{t("cpq.admin.common.create")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Rule Dialog */}
      <Dialog open={showCreateRule} onOpenChange={(open) => {
        setShowCreateRule(open);
        if (!open) { setCreateRuleCondition(null); setCreateRuleAction(null); }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("cpq.admin.rules.createTitle")}</DialogTitle>
            <DialogDescription>{t("cpq.admin.rules.createDescription")}</DialogDescription>
          </DialogHeader>
          <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.target as HTMLFormElement;
                  const name = (form.elements.namedItem("ruleName") as HTMLInputElement).value;
                  const type = newRuleType;
                  const priority = parseInt((form.elements.namedItem("priority") as HTMLInputElement).value, 10) || 0;
                  const message = (form.elements.namedItem("message") as HTMLInputElement).value;
                  if (!selectedSystemId) return;
                  createRuleMutation.mutate({
                    systemId: selectedSystemId,
                    name,
                    type,
                    priority,
                    message: message || undefined,
                    condition: type === "compatibility" ? (createRuleCondition ?? undefined) : undefined,
                    action: type === "compatibility" ? (createRuleAction ?? undefined) : undefined,
                  });
                }}
                className="space-y-4"
              >
                <div>
                  <Label htmlFor="ruleName">{t("cpq.admin.rules.nameLabel")}</Label>
                  <Input id="ruleName" name="ruleName" placeholder={t("cpq.admin.rules.namePlaceholder")} required />
                </div>
                <div>
                  <Label htmlFor="ruleType">{t("cpq.admin.rules.type")}</Label>
                  <Select value={newRuleType} onValueChange={setNewRuleType}>
                    <SelectTrigger id="ruleType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="compatibility">{t("cpq.admin.rules.types.compatibility")}</SelectItem>
                      <SelectItem value="physical">{t("cpq.admin.rules.types.physical")}</SelectItem>
                      <SelectItem value="configuration">{t("cpq.admin.rules.types.configuration")}</SelectItem>
                      <SelectItem value="business">{t("cpq.admin.rules.types.business")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {newRuleType === "compatibility" && (
                  <CpqRuleConditionEditor
                    condition={createRuleCondition}
                    onChange={(cond, act) => {
                      setCreateRuleCondition(cond);
                      setCreateRuleAction(act);
                    }}
                  />
                )}
                <div>
                  <Label htmlFor="priority">{t("cpq.admin.rules.priorityHint")}</Label>
                  <Input id="priority" name="priority" type="number" defaultValue="0" />
                </div>
                <div>
                  <Label htmlFor="message">{t("cpq.admin.rules.messageLabel")}</Label>
                  <Input id="message" name="message" placeholder={t("cpq.admin.rules.messagePlaceholder")} />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setShowCreateRule(false)}>{t("cpq.admin.common.cancel")}</Button>
                  <Button type="submit" disabled={createRuleMutation.isPending || !selectedSystemId}>{t("cpq.admin.common.create")}</Button>
                </DialogFooter>
              </form>
        </DialogContent>
      </Dialog>

      {/* Edit Rule Dialog (Geführter Modus + Experten-Modus) */}
      <Dialog open={!!editingRule} onOpenChange={(open) => !open && setEditingRule(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("cpq.admin.rules.editTitle")}</DialogTitle>
            <DialogDescription>{t("cpq.admin.rules.editDescription")}</DialogDescription>
          </DialogHeader>
          {editingRule && (
            <div className="space-y-4">
              <Tabs value={ruleEditorMode} onValueChange={(v) => setRuleEditorMode(v as "guided" | "expert")}>
                <TabsList>
                  <TabsTrigger value="guided">{t("cpq.admin.rules.modeGuided")}</TabsTrigger>
                  <TabsTrigger value="expert">{t("cpq.admin.rules.modeExpert")}</TabsTrigger>
                </TabsList>
                <TabsContent value="guided" className="space-y-4 pt-4">
                  <form
                    id="edit-rule-guided"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.target as HTMLFormElement;
                      updateRuleMutation.mutate({
                        id: editingRule.id,
                        name: (form.elements.namedItem("editRuleName") as HTMLInputElement)?.value || editingRule.name,
                        type: editRuleType,
                        priority: parseInt((form.elements.namedItem("editPriority") as HTMLInputElement)?.value || "0", 10),
                        message: (form.elements.namedItem("editMessage") as HTMLInputElement)?.value || undefined,
                        condition: editRuleType === "compatibility" ? (editRuleCondition ?? undefined) : undefined,
                        action: editRuleType === "compatibility" ? (editRuleAction ?? undefined) : undefined,
                      });
                    }}
                    className="space-y-4"
                  >
                    <div>
                      <Label>{t("cpq.admin.common.name")}</Label>
                      <Input aria-label={t("cpq.admin.common.name")} name="editRuleName" defaultValue={editingRule.name} />
                    </div>
                    <div>
                      <Label>{t("cpq.admin.rules.type")}</Label>
                      <Select value={editRuleType} onValueChange={setEditRuleType}>
                        <SelectTrigger aria-label={t("cpq.admin.rules.type")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="compatibility">{t("cpq.admin.rules.types.compatibility")}</SelectItem>
                          <SelectItem value="physical">{t("cpq.admin.rules.types.physical")}</SelectItem>
                          <SelectItem value="configuration">{t("cpq.admin.rules.types.configuration")}</SelectItem>
                          <SelectItem value="business">{t("cpq.admin.rules.types.business")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {editRuleType === "compatibility" && (
                      <CpqRuleConditionEditor
                        condition={editRuleCondition ?? editingRule.condition}
                        onChange={(cond, act) => {
                          setEditRuleCondition(cond);
                          setEditRuleAction(act);
                          setRuleExpertJson(JSON.stringify({ condition: cond, action: act }, null, 2));
                        }}
                      />
                    )}
                    <div>
                      <Label>{t("cpq.admin.rules.priority")}</Label>
                      <Input aria-label={t("cpq.admin.rules.priority")} name="editPriority" type="number" defaultValue={editingRule.priority} />
                    </div>
                    <div>
                      <Label>{t("cpq.admin.rules.messageLabel")}</Label>
                      <Input name="editMessage" defaultValue={editingRule.message || ""} placeholder={t("cpq.admin.rules.messagePlaceholder")} />
                    </div>
                  </form>
                </TabsContent>
                <TabsContent value="expert" className="pt-4">
                  <div>
                    <Label>{t("cpq.admin.rules.expertJsonLabel")}</Label>
                    <Textarea
                      value={ruleExpertJson}
                      onChange={(e) => setRuleExpertJson(e.target.value)}
                      rows={12}
                      className="font-mono text-sm mt-1"
                      placeholder='{"condition": {...}, "action": {...}}'
                    />
                  </div>
                  <form
                    id="edit-rule-expert"
                    onSubmit={(e) => {
                      e.preventDefault();
                      try {
                        const parsed = JSON.parse(ruleExpertJson) as { condition?: object; action?: object };
                        updateRuleMutation.mutate({
                          id: editingRule.id,
                          condition: parsed.condition ?? (editingRule.condition ?? undefined),
                          action: parsed.action ?? (editingRule.action ?? undefined),
                        });
                      } catch {
                        toast({ title: t("cpq.admin.toast.invalidJson"), variant: "destructive" });
                      }
                    }}
                  />
                </TabsContent>
              </Tabs>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    let cond: object | null = null;
                    let act: object | null = null;
                    if (ruleEditorMode === "guided") {
                      cond = editRuleCondition ?? editingRule.condition ?? null;
                      act = editRuleAction ?? editingRule.action ?? null;
                    } else {
                      try {
                        const parsed = JSON.parse(ruleExpertJson) as { condition?: object; action?: object };
                        cond = parsed.condition ?? null;
                        act = parsed.action ?? null;
                      } catch {
                        toast({ title: t("cpq.admin.toast.invalidJsonPreview"), variant: "destructive" });
                        return;
                      }
                    }
                    setShowRulePreview(editingRule);
                    setEditingRule(null);
                    setRulePreviewData(null);
                    try {
                      const res = await apiRequest("POST", "/api/cpq/admin/rules/preview", {
                        systemId: editingRule.systemId,
                        condition: cond,
                        action: act,
                        type: editRuleType,
                      });
                      const data = await res.json();
                      setRulePreviewData({
                        ruleName: data.ruleName ?? editingRule.name,
                        totalTested: data.totalTested ?? 0,
                        matchCount: data.matchCount ?? 0,
                        sampleMatches: data.sampleMatches ?? [],
                        source: data.source,
                      });
                    } catch {
                      setRulePreviewData(null);
                    }
                  }}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  {t("cpq.admin.common.preview")}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditingRule(null)}>{t("cpq.admin.common.cancel")}</Button>
                <Button
                  type="submit"
                  form={ruleEditorMode === "guided" ? "edit-rule-guided" : "edit-rule-expert"}
                  disabled={updateRuleMutation.isPending}
                >
                  {t("cpq.admin.common.save")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Impact-Analyse Dialog */}
      <Dialog open={!!showRuleImpact} onOpenChange={(open) => !open && setShowRuleImpact(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cpq.admin.rules.impactAnalysis")}</DialogTitle>
            <DialogDescription>{showRuleImpact?.name}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {ruleImpactData ? (
              <p>{ruleImpactData.message}</p>
            ) : (
              <p className="text-muted-foreground">{t("cpq.admin.common.loading")}</p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowRuleImpact(null)}>{t("cpq.admin.common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regel-Vorschau Dialog */}
      <Dialog open={!!showRulePreview} onOpenChange={(open) => !open && setShowRulePreview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cpq.admin.rules.previewTitle")}</DialogTitle>
            <DialogDescription>{showRulePreview?.name}</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {rulePreviewData ? (
              <>
                <div className="rounded-lg border p-4 bg-muted/30">
                  <p className="text-sm font-medium">
                    {t("cpq.admin.rules.previewSummary", { matchCount: rulePreviewData.matchCount, totalTested: rulePreviewData.totalTested })}
                  </p>
                  {rulePreviewData.source && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {rulePreviewData.source === "saved_configurations"
                        ? t("cpq.admin.rules.previewSourceSaved")
                        : t("cpq.admin.rules.previewSourceMappings")}
                    </p>
                  )}
                  {rulePreviewData.matchCount === 0 ? (
                    <p className="text-sm text-muted-foreground mt-2">
                      {t("cpq.admin.rules.previewNoMatches")}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-2">
                      {t("cpq.admin.rules.previewMatchesLabel")}
                    </p>
                  )}
                </div>
                {rulePreviewData.sampleMatches.length > 0 && (
                  <div className="space-y-2">
                    {rulePreviewData.sampleMatches.map((cfg, i) => {
                      const name = cfg._name ? String(cfg._name) : null;
                      return (
                        <div key={i} className="text-xs font-mono bg-muted/50 p-2 rounded">
                          {name && <span className="text-muted-foreground block mb-1">{name}</span>}
                          {t("cpq.admin.rules.previewMatchLine", { height: String(cfg.height ?? "—"), depth: String(cfg.depth ?? "—"), fieldCount: String(cfg.field_count ?? "—"), levelCount: String(cfg.level_count ?? "—") })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">{t("cpq.admin.common.loading")}</p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowRulePreview(null)}>{t("cpq.admin.common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Versionsverlauf Dialog */}
      <Dialog open={!!showRuleVersions} onOpenChange={(open) => !open && setShowRuleVersions(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cpq.admin.rules.versionHistory")}</DialogTitle>
            <DialogDescription>{showRuleVersions?.name}</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2 max-h-64 overflow-auto">
            {ruleVersions.length === 0 ? (
              <p className="text-muted-foreground">{t("cpq.admin.rules.versionsEmpty")}</p>
            ) : (
              ruleVersions.map((v) => (
                <div key={v.version} className="flex items-center justify-between p-2 rounded border">
                  <span>{t("cpq.admin.rules.versionLabel", { version: v.version })}</span>
                  <span className="text-xs text-muted-foreground">{v.changedAt ? fmt.dateTime(v.changedAt) : ""}</span>
                  {v.version < (showRuleVersions?.version ?? 0) && (
                    <Button size="sm" variant="outline" onClick={() => showRuleVersions && rollbackRuleMutation.mutate({ ruleId: showRuleVersions.id, version: v.version })}>
                      {t("cpq.admin.rules.rollback")}
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowRuleVersions(null)}>{t("cpq.admin.common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Component Type Dialog */}
      <Dialog open={showCreateComponentType} onOpenChange={setShowCreateComponentType}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cpq.admin.componentTypes.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("cpq.admin.componentTypes.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!selectedSystemId) return;
              createComponentTypeMutation.mutate({
                systemId: selectedSystemId,
                name: newComponentTypeName,
                role: newComponentTypeRole,
              });
            }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="ctName">{t("cpq.admin.common.name")}</Label>
              <Input
                id="ctName"
                value={newComponentTypeName}
                onChange={(e) => setNewComponentTypeName(e.target.value)}
                placeholder={t("cpq.admin.componentTypes.namePlaceholder")}
                required
              />
            </div>
            <div>
              <Label htmlFor="ctRole">{t("cpq.admin.componentTypes.role")}</Label>
              <Select value={newComponentTypeRole} onValueChange={setNewComponentTypeRole}>
                <SelectTrigger id="ctRole">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="frame">{t("cpq.admin.componentTypes.roles.frame")}</SelectItem>
                  <SelectItem value="beam">{t("cpq.admin.componentTypes.roles.beam")}</SelectItem>
                  <SelectItem value="shelf">{t("cpq.admin.componentTypes.roles.shelf")}</SelectItem>
                  <SelectItem value="connector">{t("cpq.admin.componentTypes.roles.connector")}</SelectItem>
                  <SelectItem value="accessory">{t("cpq.admin.componentTypes.roles.accessory")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateComponentType(false)}>{t("cpq.admin.common.cancel")}</Button>
              <Button type="submit" disabled={createComponentTypeMutation.isPending || !selectedSystemId || !newComponentTypeName.trim()}>
                {t("cpq.admin.common.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Mapping Dialog */}
      <Dialog open={showCreateMapping} onOpenChange={(open) => {
        setShowCreateMapping(open);
        if (!open) { setSelectedProduct(null); setNewMappingComponentTypeId(""); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cpq.admin.mappings.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("cpq.admin.mappings.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!selectedSystemId || !selectedProduct || !newMappingComponentTypeId) return;
              createMappingMutation.mutate({
                shopwareProductId: selectedProduct.id,
                shopwareProductNumber: selectedProduct.productNumber,
                productName: selectedProduct.name ?? undefined,
                systemId: selectedSystemId,
                componentTypeId: newMappingComponentTypeId,
              });
            }}
            className="space-y-4"
          >
            <div>
              <Label>{t("cpq.admin.mappings.shopwareProduct")}</Label>
              <CpqProductSelector
                value={selectedProduct}
                onChange={setSelectedProduct}
                placeholder={t("cpq.admin.mappings.productSearchPlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="mappingComponentType">{t("cpq.admin.mappings.componentType")}</Label>
              <Select value={newMappingComponentTypeId} onValueChange={setNewMappingComponentTypeId}>
                <SelectTrigger aria-label={t("cpq.admin.mappings.selectComponentType")}>
                  <SelectValue placeholder={t("cpq.admin.mappings.selectComponentType")} />
                </SelectTrigger>
                <SelectContent>
                  {componentTypes.map((ct) => (
                    <SelectItem key={ct.id} value={ct.id}>
                      {ct.name} ({ct.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedProduct && newMappingComponentTypeId && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <p className="font-medium text-muted-foreground mb-1">{t("cpq.admin.common.preview")}</p>
                <p className="font-mono text-foreground">{selectedProduct.productNumber}</p>
                {selectedProduct.name && <p className="text-muted-foreground mt-0.5">{selectedProduct.name}</p>}
                <p className="text-muted-foreground mt-2">
                  <Trans
                    t={t}
                    i18nKey="cpq.admin.mappings.assignPreview"
                    values={{ name: componentTypes.find((ct) => ct.id === newMappingComponentTypeId)?.name ?? "" }}
                    components={[<strong key="name" />]}
                  />
                </p>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateMapping(false)}>{t("cpq.admin.common.cancel")}</Button>
              <Button
                type="submit"
                disabled={createMappingMutation.isPending || !selectedSystemId || !selectedProduct || !newMappingComponentTypeId}
              >
                {t("cpq.admin.mappings.createSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Discount Level Dialog */}
      <Dialog open={showCreateDiscountLevel || !!editingDiscountLevel} onOpenChange={(open) => {
        if (!open) { setShowCreateDiscountLevel(false); setEditingDiscountLevel(null); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingDiscountLevel ? t("cpq.admin.discountLevels.editTitle") : t("cpq.admin.discountLevels.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("cpq.admin.discountLevels.dialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editingDiscountLevel) {
                updateDiscountLevelMutation.mutate({ id: editingDiscountLevel.id, data: discountLevelForm });
              } else {
                createDiscountLevelMutation.mutate(discountLevelForm);
              }
            }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="dlName">{t("cpq.admin.common.name")}</Label>
              <Input
                id="dlName"
                value={discountLevelForm.name}
                onChange={(e) => setDiscountLevelForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("cpq.admin.discountLevels.namePlaceholder")}
                required
              />
            </div>
            <div>
              <Label htmlFor="dlColor">{t("cpq.admin.discountLevels.color")}</Label>
              <div className="flex gap-2">
                <Input
                  id="dlColor"
                  type="color"
                  value={discountLevelForm.color}
                  onChange={(e) => setDiscountLevelForm((f) => ({ ...f, color: e.target.value }))}
                  className="w-12 h-10 p-1 cursor-pointer"
                />
                <Input
                  value={discountLevelForm.color}
                  onChange={(e) => setDiscountLevelForm((f) => ({ ...f, color: e.target.value }))}
                  placeholder="#22c55e"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="dlMin">{t("cpq.admin.discountLevels.discountFrom")}</Label>
                <Input
                  id="dlMin"
                  type="number"
                  min={0}
                  max={100}
                  value={discountLevelForm.discountMin}
                  onChange={(e) => setDiscountLevelForm((f) => ({ ...f, discountMin: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <Label htmlFor="dlMax">{t("cpq.admin.discountLevels.discountTo")}</Label>
                <Input
                  id="dlMax"
                  type="number"
                  min={0}
                  max={100}
                  value={discountLevelForm.discountMax}
                  onChange={(e) => setDiscountLevelForm((f) => ({ ...f, discountMax: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="dlMessage">{t("cpq.admin.discountLevels.messageLabel")}</Label>
              <Input
                id="dlMessage"
                value={discountLevelForm.messageTemplate}
                onChange={(e) => setDiscountLevelForm((f) => ({ ...f, messageTemplate: e.target.value }))}
                placeholder={t("cpq.admin.discountLevels.messagePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="dlApproval">{t("cpq.admin.discountLevels.approvalRequired")}</Label>
              <Select value={discountLevelForm.approvalType} onValueChange={(v) => setDiscountLevelForm((f) => ({ ...f, approvalType: v }))}>
                <SelectTrigger id="dlApproval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("cpq.admin.discountLevels.approvalTypes.none")}</SelectItem>
                  <SelectItem value="department_lead">{t("cpq.admin.discountLevels.approvalTypes.departmentLead")}</SelectItem>
                  <SelectItem value="management">{t("cpq.admin.discountLevels.approvalTypes.management")}</SelectItem>
                  <SelectItem value="blocked">{t("cpq.admin.discountLevels.approvalTypes.blocked")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="dlJustification"
                checked={discountLevelForm.justificationRequired}
                onChange={(e) => setDiscountLevelForm((f) => ({ ...f, justificationRequired: e.target.checked }))}
              />
              <Label htmlFor="dlJustification">{t("cpq.admin.discountLevels.justificationRequired")}</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setShowCreateDiscountLevel(false); setEditingDiscountLevel(null); }}>{t("cpq.admin.common.cancel")}</Button>
              <Button type="submit" disabled={createDiscountLevelMutation.isPending || updateDiscountLevelMutation.isPending || !discountLevelForm.name.trim()}>
                {editingDiscountLevel ? t("cpq.admin.common.save") : t("cpq.admin.common.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
