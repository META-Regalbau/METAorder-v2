import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "react-i18next";

type TicketAssignmentRule = {
  id: string;
  name: string;
  active: number;
  priority: number;
  assignmentType: string;
  conditions: string | null;
  assignToUserId: string | null;
  assignToRoleId: string | null;
};

type ParsedConditions = {
  category?: string;
  priority?: string;
  aiCategory?: string;
  aiPriority?: string;
  aiSentiment?: string;
  keywords?: string | string[];
  minConfidence?: number;
};

export default function TicketRulesPage() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<TicketAssignmentRule | null>(null);
  
  // Form state
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(0);
  const [assignmentType, setAssignmentType] = useState<"round_robin" | "rule_based">("round_robin");
  const [category, setCategory] = useState("");
  const [priorityCondition, setPriorityCondition] = useState("");
  const [aiCategory, setAiCategory] = useState("");
  const [aiPriority, setAiPriority] = useState("");
  const [aiSentiment, setAiSentiment] = useState("");
  const [keywords, setKeywords] = useState("");
  const [minConfidence, setMinConfidence] = useState("");
  const [assignToUserId, setAssignToUserId] = useState("");

  const { data: rules = [], isLoading } = useQuery<TicketAssignmentRule[]>({
    queryKey: ["/api/ticket-assignment-rules"],
  });

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["/api/users/assignable"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/ticket-assignment-rules", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ticket-assignment-rules"] });
      resetForm();
      setIsCreateDialogOpen(false);
      toast({ title: "Rule created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create rule", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest("PATCH", `/api/ticket-assignment-rules/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ticket-assignment-rules"] });
      toast({ title: "Rule updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update rule", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/ticket-assignment-rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ticket-assignment-rules"] });
      toast({ title: "Rule deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete rule", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setName("");
    setPriority(0);
    setAssignmentType("round_robin");
    setCategory("");
    setPriorityCondition("");
    setAiCategory("");
    setAiPriority("");
    setAiSentiment("");
    setKeywords("");
    setMinConfidence("");
    setAssignToUserId("");
    setEditingRule(null);
  };

  const handleSubmit = () => {
    const conditions = assignmentType === "rule_based" 
      ? JSON.stringify({
          category,
          priority: priorityCondition,
          aiCategory: aiCategory || undefined,
          aiPriority: aiPriority || undefined,
          aiSentiment: aiSentiment || undefined,
          keywords: keywords || undefined,
          minConfidence: minConfidence ? Number(minConfidence) : undefined,
        }) 
      : null;
    
    const data = {
      name,
      active: 1,
      priority,
      assignmentType,
      conditions,
      assignToUserId: assignToUserId || null,
      assignToRoleId: null,
    };

    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data });
      setEditingRule(null);
      setIsCreateDialogOpen(false);
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (rule: TicketAssignmentRule) => {
    setEditingRule(rule);
    setName(rule.name);
    setPriority(rule.priority);
    setAssignmentType(rule.assignmentType as "round_robin" | "rule_based");
    if (rule.conditions) {
      try {
        const parsed = JSON.parse(rule.conditions);
        setCategory(parsed.category || "");
        setPriorityCondition(parsed.priority || "");
        setAiCategory(parsed.aiCategory || "");
        setAiPriority(parsed.aiPriority || "");
        setAiSentiment(parsed.aiSentiment || "");
        setKeywords(parsed.keywords || "");
        setMinConfidence(parsed.minConfidence ? String(parsed.minConfidence) : "");
      } catch {}
    }
    setAssignToUserId(rule.assignToUserId || "");
    setIsCreateDialogOpen(true);
  };

  const handleToggle = (rule: TicketAssignmentRule) => {
    updateMutation.mutate({
      id: rule.id,
      data: { active: rule.active === 1 ? 0 : 1 },
    });
  };

  const renderConditions = (rule: TicketAssignmentRule) => {
    if (!rule.conditions) return null;
    try {
      const parsed = JSON.parse(rule.conditions) as ParsedConditions;
      const parts: string[] = [];

      if (parsed.category) parts.push(`Category: ${parsed.category}`);
      if (parsed.priority) parts.push(`Priority: ${parsed.priority}`);
      if (parsed.aiCategory) parts.push(`AI Category: ${parsed.aiCategory}`);
      if (parsed.aiPriority) parts.push(`AI Priority: ${parsed.aiPriority}`);
      if (parsed.aiSentiment) parts.push(`AI Sentiment: ${parsed.aiSentiment}`);
      if (parsed.minConfidence !== undefined) parts.push(`Min AI Confidence: ${parsed.minConfidence}`);
      if (parsed.keywords) {
        const keywords = Array.isArray(parsed.keywords) ? parsed.keywords : String(parsed.keywords).split(",");
        const cleaned = keywords.map((k) => k.trim()).filter(Boolean);
        if (cleaned.length > 0) parts.push(`Keywords: ${cleaned.join(", ")}`);
      }

      if (parts.length === 0) return null;
      return parts.join(" · ");
    } catch {
      return rule.conditions;
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">Ticket Assignment Rules</h1>
          <p className="text-sm text-muted-foreground">
            Configure automatic ticket assignment rules
          </p>
        </div>
        <Button onClick={() => { resetForm(); setIsCreateDialogOpen(true); }} data-testid="button-create-rule">
          <Plus className="w-4 h-4 mr-2" />
          New Rule
        </Button>
      </div>

      {isLoading ? (
        <Card className="p-6">Loading...</Card>
      ) : rules.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">
          No assignment rules yet. Create one to get started.
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map((rule: TicketAssignmentRule) => (
            <Card key={rule.id} className="p-4" data-testid={`rule-${rule.id}`}>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium">{rule.name}</h3>
                    <Badge variant={rule.assignmentType === "round_robin" ? "default" : "secondary"}>
                      {rule.assignmentType === "round_robin" ? "Round Robin" : "Rule Based"}
                    </Badge>
                    <Badge variant="outline">Priority: {rule.priority}</Badge>
                  </div>
                  {rule.assignmentType === "rule_based" && rule.conditions && (
                    <p className="text-sm text-muted-foreground">
                      Conditions: {renderConditions(rule)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Active</Label>
                    <Switch
                      checked={rule.active === 1}
                      onCheckedChange={() => handleToggle(rule)}
                      data-testid={`switch-active-${rule.id}`}
                    />
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(rule)} data-testid={`button-edit-${rule.id}`}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(rule.id)} data-testid={`button-delete-${rule.id}`}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent data-testid="dialog-create-rule">
          <DialogHeader>
            <DialogTitle>{editingRule ? "Edit Rule" : "Create Assignment Rule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Rule Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., High Priority Round Robin" data-testid="input-rule-name" />
            </div>
            <div>
              <Label>Priority (higher = runs first)</Label>
              <Input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} data-testid="input-priority" />
            </div>
            <div>
              <Label>Assignment Type</Label>
              <Select value={assignmentType} onValueChange={(v: any) => setAssignmentType(v)}>
                <SelectTrigger data-testid="select-assignment-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="round_robin">Round Robin</SelectItem>
                  <SelectItem value="rule_based">Rule Based</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {assignmentType === "rule_based" && (
              <>
                <div>
                  <Label>Category Filter</Label>
                  <Select value={category || "__none__"} onValueChange={(value) => setCategory(value === "__none__" ? "" : value)}>
                    <SelectTrigger data-testid="select-category">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Any</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                      <SelectItem value="order_issue">Order Issue</SelectItem>
                      <SelectItem value="product_inquiry">Product Inquiry</SelectItem>
                      <SelectItem value="technical_support">Technical Support</SelectItem>
                      <SelectItem value="complaint">Complaint</SelectItem>
                      <SelectItem value="feature_request">Feature Request</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Priority Filter</Label>
                  <Select value={priorityCondition || "__none__"} onValueChange={(value) => setPriorityCondition(value === "__none__" ? "" : value)}>
                    <SelectTrigger data-testid="select-priority-filter">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Any</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>AI Category Filter</Label>
                  <Select value={aiCategory || "__none__"} onValueChange={(value) => setAiCategory(value === "__none__" ? "" : value)}>
                    <SelectTrigger data-testid="select-ai-category">
                      <SelectValue placeholder="Select AI category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Any</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                      <SelectItem value="order_issue">Order Issue</SelectItem>
                      <SelectItem value="product_inquiry">Product Inquiry</SelectItem>
                      <SelectItem value="technical_support">Technical Support</SelectItem>
                      <SelectItem value="complaint">Complaint</SelectItem>
                      <SelectItem value="feature_request">Feature Request</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>AI Priority Filter</Label>
                  <Select value={aiPriority || "__none__"} onValueChange={(value) => setAiPriority(value === "__none__" ? "" : value)}>
                    <SelectTrigger data-testid="select-ai-priority">
                      <SelectValue placeholder="Select AI priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Any</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>AI Sentiment Filter</Label>
                  <Select value={aiSentiment || "__none__"} onValueChange={(value) => setAiSentiment(value === "__none__" ? "" : value)}>
                    <SelectTrigger data-testid="select-ai-sentiment">
                      <SelectValue placeholder="Select sentiment" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Any</SelectItem>
                      <SelectItem value="positive">Positive</SelectItem>
                      <SelectItem value="neutral">Neutral</SelectItem>
                      <SelectItem value="negative">Negative</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Keywords</Label>
                  <Input
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    placeholder="e.g. invoice, refund"
                    data-testid="input-keywords"
                  />
                </div>
                <div>
                  <Label>Minimum AI Confidence</Label>
                  <Input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={minConfidence}
                    onChange={(e) => setMinConfidence(e.target.value)}
                    placeholder="0.7"
                    data-testid="input-ai-confidence"
                  />
                </div>
                <div>
                  <Label>Assign To User</Label>
                  <Select value={assignToUserId} onValueChange={setAssignToUserId}>
                    <SelectTrigger data-testid="select-assign-to">
                      <SelectValue placeholder="Select user" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((user: any) => (
                        <SelectItem key={user.id} value={user.id}>{user.username}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setIsCreateDialogOpen(false); }} data-testid="button-cancel">
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!name || createMutation.isPending || updateMutation.isPending} data-testid="button-save">
              {editingRule ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
