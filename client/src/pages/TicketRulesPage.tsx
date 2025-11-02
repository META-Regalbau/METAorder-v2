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
    setAssignToUserId("");
    setEditingRule(null);
  };

  const handleSubmit = () => {
    const conditions = assignmentType === "rule_based" 
      ? JSON.stringify({ category, priority: priorityCondition }) 
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

  return (
    <div className="max-w-4xl">
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
                      Conditions: {rule.conditions}
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
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger data-testid="select-category">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General</SelectItem>
                      <SelectItem value="order_issue">Order Issue</SelectItem>
                      <SelectItem value="product_inquiry">Product Inquiry</SelectItem>
                      <SelectItem value="technical_support">Technical Support</SelectItem>
                      <SelectItem value="complaint">Complaint</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Priority Filter</Label>
                  <Select value={priorityCondition} onValueChange={setPriorityCondition}>
                    <SelectTrigger data-testid="select-priority-filter">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
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
