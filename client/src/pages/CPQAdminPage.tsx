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
import CpqRuleConditionEditor from "@/components/cpq/CpqRuleConditionEditor";
import CpqComponentSidebar from "@/components/cpq/CpqComponentSidebar";
import CpqDetailPanel from "@/components/cpq/CpqDetailPanel";

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
      toast({ title: "System erstellt", description: "Das Regalsystem wurde angelegt." });
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
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
      toast({ title: "Regel aktualisiert", description: "Die CPQ-Regel wurde gespeichert." });
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
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
      toast({ title: "Regel erstellt", description: "Die CPQ-Regel wurde angelegt." });
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
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
      toast({ title: "Rollback durchgeführt", description: "Die Regel wurde auf die gewählte Version zurückgesetzt." });
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
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
      toast({ title: "Komponententyp erstellt", description: "Der Komponententyp wurde angelegt." });
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
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
      toast({ title: "Produkt-Mapping erstellt", description: "Das Shopware-Produkt wurde dem CPQ-System zugeordnet." });
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
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
      toast({ title: "Ampelstufe erstellt", description: "Die Rabatt-Ampel-Stufe wurde angelegt." });
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
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
      toast({ title: "Ampelstufe aktualisiert", description: "Die Rabatt-Ampel-Stufe wurde gespeichert." });
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const deleteDiscountLevelMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/cpq/admin/discount-levels/${id}`);
      if (!res.ok) throw new Error("Failed to delete discount level");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cpq/admin/discount-levels"] });
      toast({ title: "Ampelstufe gelöscht", description: "Die Rabatt-Ampel-Stufe wurde entfernt." });
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const componentTypes = componentsData?.componentTypes ?? [];
  const mappings = componentsData?.mappings ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">CPQ Admin – Konfigurator & Regeln</h1>
        <p className="text-muted-foreground">Regalsysteme, Regeln und Rabatt-Ampel verwalten</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="systems">Systeme</TabsTrigger>
          <TabsTrigger value="graph">Node-System / Beziehungsgraph</TabsTrigger>
          <TabsTrigger value="mappings" disabled={!selectedSystemId}>Produkt-Mappings</TabsTrigger>
          <TabsTrigger value="rules" disabled={!selectedSystemId}>Regeln</TabsTrigger>
          <TabsTrigger value="discount-levels">Rabatt-Ampel</TabsTrigger>
          <TabsTrigger value="reporting">Rabatt-Reporting</TabsTrigger>
        </TabsList>

        <TabsContent value="systems" className="space-y-4 mt-4">
          <Card>
            <div className="p-4 flex justify-between items-center border-b">
              <h2 className="font-semibold">Regalsysteme</h2>
              <Button onClick={() => setShowCreateSystem(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Neues System
              </Button>
            </div>
            {systemsLoading ? (
              <div className="p-4"><Skeleton className="h-24 w-full" /></div>
            ) : systems.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                Noch keine Regalsysteme angelegt. Erstellen Sie ein System, um Regeln und Komponenten zu verwalten.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Aktion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {systems.map((sys) => (
                    <TableRow key={sys.id} className={selectedSystemId === sys.id ? "bg-muted/50" : ""}>
                      <TableCell>{sys.name}</TableCell>
                      <TableCell><code className="text-xs">{sys.slug}</code></TableCell>
                      <TableCell><Badge variant={sys.status === "active" ? "default" : "secondary"}>{sys.status}</Badge></TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => setSelectedSystemId(sys.id)}>
                          Auswählen
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
                <h2 className="font-semibold text-lg">Node-System / Beziehungsgraph</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Der Beziehungsgraph zeigt System → Komponententypen → Artikel. Wählen Sie zuerst ein Regalsystem im Tab &quot;Systeme&quot; aus (Button &quot;Auswählen&quot;).
                </p>
                {systems.length > 0 ? (
                  <div className="flex flex-wrap justify-center gap-2 mt-4">
                    {systems.map((sys) => (
                      <Button key={sys.id} variant="outline" onClick={() => setSelectedSystemId(sys.id)}>
                        {sys.name} auswählen
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Noch keine Systeme vorhanden. Legen Sie im Tab &quot;Systeme&quot; ein neues an.</p>
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
                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-background text-foreground border"
                  >
                    Beziehungsgraph
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => toast({ title: "Tabellenansicht", description: "kommt in Phase 2" })}
                  >
                    Tabellenansicht
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => toast({ title: "Kompatibilitätsmatrix", description: "kommt in Phase 2" })}
                  >
                    Kompatibilitätsmatrix
                  </button>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Button variant="outline" size="icon" className="h-7 w-7" title="Verkleinern">−</Button>
                    <span>100%</span>
                    <Button variant="outline" size="icon" className="h-7 w-7" title="Vergrößern">+</Button>
                  </div>
                </div>

                {/* Graph */}
                <div className="flex-1 min-h-0">
                  {componentTypes.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                      Keine Komponententypen. Legen Sie zuerst Komponententypen im Tab &quot;Produkt-Mappings&quot; an.
                    </div>
                  ) : (
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
                  )}
                </div>
              </div>

              {/* Detail Panel 420px */}
              <CpqDetailPanel
                selectedNodeId={graphSelectedNodeId}
                selectedNodeType={graphSelectedNodeType}
                systemName={systems.find((s) => s.id === selectedSystemId)?.name ?? "System"}
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
                    <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Vorschau der Mappings</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {mappings.length} {mappings.length === 1 ? "Produkt" : "Produkte"} in {componentTypes.length} {componentTypes.length === 1 ? "Komponententyp" : "Komponententypen"}
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
                    Produkt-Mappings für {systems.find((s) => s.id === selectedSystemId)?.name || "System"}
                  </h2>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowCreateComponentType(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Komponententyp
                    </Button>
                    <Button onClick={() => setShowCreateMapping(true)} disabled={componentTypes.length === 0}>
                      <Link2 className="h-4 w-4 mr-2" />
                      Neues Mapping
                    </Button>
                  </div>
                </div>
                {componentTypes.length === 0 && (
                  <div className="p-6 border-b bg-muted/30">
                    <p className="text-sm text-muted-foreground mb-3">
                      Erstellen Sie zuerst mindestens einen Komponententyp (z.B. Steher, Traverse, Zubehör), 
                      bevor Sie Shopware-Produkte zuordnen können.
                    </p>
                    <Button size="sm" onClick={() => setShowCreateComponentType(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Ersten Komponententyp anlegen
                    </Button>
                  </div>
                )}
                {componentsLoading ? (
                  <div className="p-4"><Skeleton className="h-24 w-full" /></div>
                ) : mappings.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    Noch keine Produkt-Mappings. Klicken Sie auf &quot;Neues Mapping&quot;, um ein Shopware-Produkt 
                    diesem System und einem Komponententyp zuzuordnen.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Artikelnummer / Produktname</TableHead>
                        <TableHead>Shopware-ID</TableHead>
                        <TableHead>Komponententyp</TableHead>
                        <TableHead>Status</TableHead>
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
                          <TableCell><Badge variant={m.status === "active" ? "default" : "secondary"}>{m.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
              {componentTypes.length > 0 && (
                <Card>
                  <div className="p-4 border-b">
                    <h3 className="font-semibold">Komponententypen</h3>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Rolle</TableHead>
                        <TableHead>Pflicht</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {componentTypes.map((ct) => (
                        <TableRow key={ct.id}>
                          <TableCell>{ct.name}</TableCell>
                          <TableCell><Badge variant="outline">{ct.role}</Badge></TableCell>
                          <TableCell>{ct.required ? "Ja" : "Nein"}</TableCell>
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
                <h2 className="font-semibold">CPQ-Regeln für {systems.find((s) => s.id === selectedSystemId)?.name || "System"}</h2>
                <Button onClick={() => setShowCreateRule(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Neue Regel
                </Button>
              </div>
              {rulesLoading ? (
                <div className="p-4"><Skeleton className="h-32 w-full" /></div>
              ) : rules.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  Keine Regeln für dieses System. Erstellen Sie eine Regel (Kompatibilität, physikalisch, Konfiguration, Geschäft).
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Typ</TableHead>
                      <TableHead>Priorität</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Aktionen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                        <TableCell>{r.priority}</TableCell>
                        <TableCell><Badge variant={r.status === "active" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
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
                          <Button variant="ghost" size="sm" title="Vorschau – Treffer gegen Test-Konfigurationen" onClick={async () => {
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
                          <Button variant="ghost" size="sm" title="Impact-Analyse" onClick={async () => {
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
                          <Button variant="ghost" size="sm" title="Versionsverlauf" onClick={async () => {
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
              <h2 className="font-semibold">Rabatt-Ampel Stufen</h2>
              <Button onClick={() => {
                setEditingDiscountLevel(null);
                setDiscountLevelForm({ name: "", color: "#22c55e", discountMin: 0, discountMax: 10, messageTemplate: "", approvalType: "none", justificationRequired: false });
                setShowCreateDiscountLevel(true);
              }}>
                <Plus className="h-4 w-4 mr-2" />
                Neue Stufe
              </Button>
            </div>
            {discountLevelsLoading ? (
              <div className="p-4"><Skeleton className="h-24 w-full" /></div>
            ) : adminDiscountLevels.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                Noch keine Ampelstufen angelegt. Erstellen Sie Stufen, um Rabatte nach Farbe (Grün/Gelb/Orange/Rot) zu bewerten.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Farbe</TableHead>
                    <TableHead>Rabatt %</TableHead>
                    <TableHead>Freigabe</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Aktionen</TableHead>
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
                      <TableCell><Badge variant="outline">{dl.approvalType}</Badge></TableCell>
                      <TableCell><Badge variant={dl.status === "active" ? "default" : "secondary"}>{dl.status}</Badge></TableCell>
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
                Rabatt-Übersicht
              </h2>
              <div className="flex items-center gap-2 ml-auto">
                <div>
                  <Label className="text-xs">Von</Label>
                  <Input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} className="w-36" />
                </div>
                <div>
                  <Label className="text-xs">Bis</Label>
                  <Input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} className="w-36" />
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
                      <p className="text-sm text-muted-foreground">Umsatzverlust gesamt</p>
                      <p className="text-xl font-semibold">€{Number(discountOverview.totalRevenueLoss).toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="rounded-lg border p-4 flex items-center gap-3">
                    <div className="p-2 rounded-full bg-muted">
                      <BarChart3 className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Anzahl Einträge</p>
                      <p className="text-xl font-semibold">{discountOverview.totalEntries}</p>
                    </div>
                  </div>
                </div>

                {Object.keys(discountOverview.byLevel).length > 0 && (
                  <div>
                    <h3 className="font-medium mb-2">Nach Ampelstufe</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Stufe</TableHead>
                          <TableHead>Anzahl</TableHead>
                          <TableHead>Umsatzverlust</TableHead>
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
                              <TableCell>€{Number(stats.totalRevenueLoss).toFixed(2)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {discountOverview.entries.length > 0 && (
                  <div>
                    <h3 className="font-medium mb-2">Letzte Einträge (max. 100)</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Datum</TableHead>
                          <TableHead>Angebot</TableHead>
                          <TableHead>Rabatt %</TableHead>
                          <TableHead>Umsatzverlust</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {discountOverview.entries.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell className="text-sm">
                              {e.createdAt ? new Date(e.createdAt).toLocaleString("de-DE") : "-"}
                            </TableCell>
                            <TableCell><code className="text-xs">{e.offerId}</code></TableCell>
                            <TableCell>{e.discountPercent != null ? Number(e.discountPercent).toFixed(1) + "%" : "-"}</TableCell>
                            <TableCell>€{e.revenueLoss != null ? Number(e.revenueLoss).toFixed(2) : "0.00"}</TableCell>
                            <TableCell>
                              <Badge variant={e.approvalStatus === "approved" ? "default" : e.approvalStatus === "rejected" ? "destructive" : "secondary"}>
                                {e.approvalStatus || "pending"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {discountOverview.totalEntries === 0 && (
                  <p className="text-muted-foreground text-center py-8">Keine Rabatt-Protokolle im gewählten Zeitraum.</p>
                )}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">Daten konnten nicht geladen werden.</div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create System Dialog */}
      <Dialog open={showCreateSystem} onOpenChange={setShowCreateSystem}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neues Regalsystem</DialogTitle>
            <DialogDescription>Erstellen Sie ein neues Regalsystem (z.B. META CLIP, META FIX).</DialogDescription>
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
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="z.B. META CLIP" required />
            </div>
            <div>
              <Label htmlFor="slug">Slug</Label>
              <Input id="slug" name="slug" placeholder="meta-clip" required />
            </div>
            <div>
              <Label htmlFor="description">Beschreibung (optional)</Label>
              <Textarea id="description" name="description" rows={3} placeholder="Beschreibung des Regalsystems" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateSystem(false)}>Abbrechen</Button>
              <Button type="submit" disabled={createSystemMutation.isPending}>Erstellen</Button>
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
            <DialogTitle>Neue CPQ-Regel</DialogTitle>
            <DialogDescription>Erstellen Sie eine Regel für das gewählte System. Wählen Sie Eigenschaften aus oder nutzen Sie den Experten-Modus (JSON) für komplexe Regeln.</DialogDescription>
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
                  <Label htmlFor="ruleName">Regelname</Label>
                  <Input id="ruleName" name="ruleName" placeholder="z.B. Ständer und Böden – gleiche Tiefe erforderlich" required />
                </div>
                <div>
                  <Label htmlFor="ruleType">Typ</Label>
                  <Select value={newRuleType} onValueChange={setNewRuleType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="compatibility">Kompatibilität</SelectItem>
                      <SelectItem value="physical">Physikalisch</SelectItem>
                      <SelectItem value="configuration">Konfiguration</SelectItem>
                      <SelectItem value="business">Geschäft</SelectItem>
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
                  <Label htmlFor="priority">Priorität (niedrig = zuerst)</Label>
                  <Input id="priority" name="priority" type="number" defaultValue="0" />
                </div>
                <div>
                  <Label htmlFor="message">Nachricht (optional)</Label>
                  <Input id="message" name="message" placeholder="Nutzer-sichtbare Nachricht" />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setShowCreateRule(false)}>Abbrechen</Button>
                  <Button type="submit" disabled={createRuleMutation.isPending || !selectedSystemId}>Erstellen</Button>
                </DialogFooter>
              </form>
        </DialogContent>
      </Dialog>

      {/* Edit Rule Dialog (Geführter Modus + Experten-Modus) */}
      <Dialog open={!!editingRule} onOpenChange={(open) => !open && setEditingRule(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Regel bearbeiten</DialogTitle>
            <DialogDescription>Geführter Modus oder Experten-Modus (JSON) für komplexe Regeln.</DialogDescription>
          </DialogHeader>
          {editingRule && (
            <div className="space-y-4">
              <Tabs value={ruleEditorMode} onValueChange={(v) => setRuleEditorMode(v as "guided" | "expert")}>
                <TabsList>
                  <TabsTrigger value="guided">Geführt</TabsTrigger>
                  <TabsTrigger value="expert">Experte (JSON)</TabsTrigger>
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
                      <Label>Name</Label>
                      <Input name="editRuleName" defaultValue={editingRule.name} />
                    </div>
                    <div>
                      <Label>Typ</Label>
                      <Select value={editRuleType} onValueChange={setEditRuleType}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="compatibility">Kompatibilität</SelectItem>
                          <SelectItem value="physical">Physikalisch</SelectItem>
                          <SelectItem value="configuration">Konfiguration</SelectItem>
                          <SelectItem value="business">Geschäft</SelectItem>
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
                      <Label>Priorität</Label>
                      <Input name="editPriority" type="number" defaultValue={editingRule.priority} />
                    </div>
                    <div>
                      <Label>Nachricht (optional)</Label>
                      <Input name="editMessage" defaultValue={editingRule.message || ""} placeholder="Nutzer-sichtbare Nachricht" />
                    </div>
                  </form>
                </TabsContent>
                <TabsContent value="expert" className="pt-4">
                  <div>
                    <Label>Condition & Action (JSON)</Label>
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
                        toast({ title: "Ungültiges JSON", variant: "destructive" });
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
                        toast({ title: "Ungültiges JSON für Vorschau", variant: "destructive" });
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
                  Vorschau
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditingRule(null)}>Abbrechen</Button>
                <Button
                  type="submit"
                  form={ruleEditorMode === "guided" ? "edit-rule-guided" : "edit-rule-expert"}
                  disabled={updateRuleMutation.isPending}
                >
                  Speichern
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
            <DialogTitle>Impact-Analyse</DialogTitle>
            <DialogDescription>{showRuleImpact?.name}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {ruleImpactData ? (
              <p>{ruleImpactData.message}</p>
            ) : (
              <p className="text-muted-foreground">Laden…</p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowRuleImpact(null)}>Schließen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Regel-Vorschau Dialog */}
      <Dialog open={!!showRulePreview} onOpenChange={(open) => !open && setShowRulePreview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vorschau – Regel-Treffer</DialogTitle>
            <DialogDescription>{showRulePreview?.name}</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {rulePreviewData ? (
              <>
                <div className="rounded-lg border p-4 bg-muted/30">
                  <p className="text-sm font-medium">
                    Bei {rulePreviewData.matchCount} von {rulePreviewData.totalTested} Konfigurationen trifft die Regel zu.
                  </p>
                  {rulePreviewData.source && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {rulePreviewData.source === "saved_configurations"
                        ? "Basis: gespeicherte Konfigurationen dieses Systems."
                        : "Basis: Kombinationen aus Produkt-Mapping-Attributen (Höhe, Tiefe, Feldzahl, Ebenen)."}
                    </p>
                  )}
                  {rulePreviewData.matchCount === 0 ? (
                    <p className="text-sm text-muted-foreground mt-2">
                      Keine Treffer. Die Regel-Bedingung passt auf keine der Konfigurationen im System. Prüfen Sie die Bedingung.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-2">
                      Treffende Konfigurationen:
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
                          Höhe {String(cfg.height ?? "—")} mm, Tiefe {String(cfg.depth ?? "—")} mm · {String(cfg.field_count ?? "—")} Felder × {String(cfg.level_count ?? "—")} Ebenen
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">Laden…</p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowRulePreview(null)}>Schließen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Versionsverlauf Dialog */}
      <Dialog open={!!showRuleVersions} onOpenChange={(open) => !open && setShowRuleVersions(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Versionsverlauf</DialogTitle>
            <DialogDescription>{showRuleVersions?.name}</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2 max-h-64 overflow-auto">
            {ruleVersions.length === 0 ? (
              <p className="text-muted-foreground">Keine Versionen oder laden…</p>
            ) : (
              ruleVersions.map((v) => (
                <div key={v.version} className="flex items-center justify-between p-2 rounded border">
                  <span>Version {v.version}</span>
                  <span className="text-xs text-muted-foreground">{v.changedAt ? new Date(v.changedAt).toLocaleString() : ""}</span>
                  {v.version < (showRuleVersions?.version ?? 0) && (
                    <Button size="sm" variant="outline" onClick={() => showRuleVersions && rollbackRuleMutation.mutate({ ruleId: showRuleVersions.id, version: v.version })}>
                      Rollback
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowRuleVersions(null)}>Schließen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Component Type Dialog */}
      <Dialog open={showCreateComponentType} onOpenChange={setShowCreateComponentType}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neuer Komponententyp</DialogTitle>
            <DialogDescription>
              Legen Sie einen Komponententyp für das Regalsystem an (z.B. Steher, Traverse, Zubehör).
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
              <Label htmlFor="ctName">Name</Label>
              <Input
                id="ctName"
                value={newComponentTypeName}
                onChange={(e) => setNewComponentTypeName(e.target.value)}
                placeholder="z.B. Steher, Traverse"
                required
              />
            </div>
            <div>
              <Label htmlFor="ctRole">Rolle</Label>
              <Select value={newComponentTypeRole} onValueChange={setNewComponentTypeRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="frame">Rahmen (frame)</SelectItem>
                  <SelectItem value="beam">Träger (beam)</SelectItem>
                  <SelectItem value="shelf">Boden (shelf)</SelectItem>
                  <SelectItem value="connector">Verbindung (connector)</SelectItem>
                  <SelectItem value="accessory">Zubehör (accessory)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateComponentType(false)}>Abbrechen</Button>
              <Button type="submit" disabled={createComponentTypeMutation.isPending || !selectedSystemId || !newComponentTypeName.trim()}>
                Erstellen
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
            <DialogTitle>Neues Produkt-Mapping</DialogTitle>
            <DialogDescription>
              Ordnen Sie ein Shopware-Produkt dem Regalsystem und einem Komponententyp zu.
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
              <Label>Shopware-Produkt</Label>
              <CpqProductSelector
                value={selectedProduct}
                onChange={setSelectedProduct}
                placeholder="Produkt suchen (min. 2 Zeichen)"
              />
            </div>
            <div>
              <Label htmlFor="mappingComponentType">Komponententyp</Label>
              <Select value={newMappingComponentTypeId} onValueChange={setNewMappingComponentTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Komponententyp wählen" />
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
                <p className="font-medium text-muted-foreground mb-1">Vorschau</p>
                <p className="font-mono text-foreground">{selectedProduct.productNumber}</p>
                {selectedProduct.name && <p className="text-muted-foreground mt-0.5">{selectedProduct.name}</p>}
                <p className="text-muted-foreground mt-2">
                  → wird dem Komponententyp <strong>{componentTypes.find((ct) => ct.id === newMappingComponentTypeId)?.name ?? ""}</strong> zugeordnet.
                </p>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateMapping(false)}>Abbrechen</Button>
              <Button
                type="submit"
                disabled={createMappingMutation.isPending || !selectedSystemId || !selectedProduct || !newMappingComponentTypeId}
              >
                Mapping erstellen
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
            <DialogTitle>{editingDiscountLevel ? "Ampelstufe bearbeiten" : "Neue Ampelstufe"}</DialogTitle>
            <DialogDescription>
              Definieren Sie den Rabatt-Bereich und die Farbe für diese Ampelstufe.
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
              <Label htmlFor="dlName">Name</Label>
              <Input
                id="dlName"
                value={discountLevelForm.name}
                onChange={(e) => setDiscountLevelForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="z.B. Optimal, Erhöht, Kritisch"
                required
              />
            </div>
            <div>
              <Label htmlFor="dlColor">Farbe</Label>
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
                <Label htmlFor="dlMin">Rabatt von (%)</Label>
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
                <Label htmlFor="dlMax">Rabatt bis (%)</Label>
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
              <Label htmlFor="dlMessage">Nachricht (optional, Platzhalter: {"{verlust}"}, {"{marge}"})</Label>
              <Input
                id="dlMessage"
                value={discountLevelForm.messageTemplate}
                onChange={(e) => setDiscountLevelForm((f) => ({ ...f, messageTemplate: e.target.value }))}
                placeholder="Standardrabatt – Angebot kann direkt raus"
              />
            </div>
            <div>
              <Label htmlFor="dlApproval">Freigabe erforderlich</Label>
              <Select value={discountLevelForm.approvalType} onValueChange={(v) => setDiscountLevelForm((f) => ({ ...f, approvalType: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Keine</SelectItem>
                  <SelectItem value="department_lead">Abteilungsleiter</SelectItem>
                  <SelectItem value="management">Geschäftsführung</SelectItem>
                  <SelectItem value="blocked">Gesperrt (nicht freigabefähig)</SelectItem>
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
              <Label htmlFor="dlJustification">Begründung erforderlich</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setShowCreateDiscountLevel(false); setEditingDiscountLevel(null); }}>Abbrechen</Button>
              <Button type="submit" disabled={createDiscountLevelMutation.isPending || updateDiscountLevelMutation.isPending || !discountLevelForm.name.trim()}>
                {editingDiscountLevel ? "Speichern" : "Erstellen"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
