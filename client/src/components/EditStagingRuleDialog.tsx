import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import RuleBuilder from "@/components/RuleBuilder";
import type { CrossSellStagingRule, RuleCondition, RuleTargetCriteria } from "@shared/schema";

interface EditStagingRuleDialogProps {
  rule: CrossSellStagingRule | null;
  open: boolean;
  onClose: () => void;
}

export default function EditStagingRuleDialog({ rule, open, onClose }: EditStagingRuleDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [sourceConditions, setSourceConditions] = useState<RuleCondition[]>([]);
  const [targetCriteria, setTargetCriteria] = useState<RuleTargetCriteria[]>([]);

  useEffect(() => {
    if (rule) {
      setName(rule.name);
      setDescription(rule.description || "");
      setActive(!!rule.active);
      setSourceConditions(rule.sourceConditions || []);
      setTargetCriteria(rule.targetCriteria || []);
    }
  }, [rule]);

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("PUT", `/api/cross-selling/staging/rules/${rule!.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/staging"] });
      toast({
        title: t("rules.updated"),
        description: t("rules.updatedDescription"),
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: t("rules.updateError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!name.trim()) {
      toast({
        title: t("errors.validationFailed"),
        description: t("rules.nameRequired"),
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      active: active ? 1 : 0,
      sourceConditions,
      targetCriteria,
    });
  };

  if (!rule) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("rules.edit")}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="basic">{t("ruleBuilder.basicTab")}</TabsTrigger>
            <TabsTrigger value="conditions">{t("ruleBuilder.conditionsTab")}</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-staging-name">{t("rules.name")}</Label>
              <Input
                id="edit-staging-name"
                placeholder={t("rules.namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-staging-description">{t("rules.description")}</Label>
              <Textarea
                id="edit-staging-description"
                placeholder={t("rules.descriptionPlaceholder")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="edit-staging-active">{t("rules.status")}</Label>
                <p className="text-sm text-muted-foreground">
                  {active ? t("rules.active") : t("rules.inactive")}
                </p>
              </div>
              <Switch id="edit-staging-active" checked={active} onCheckedChange={setActive} />
            </div>
          </TabsContent>

          <TabsContent value="conditions">
            <RuleBuilder
              sourceConditions={sourceConditions}
              targetCriteria={targetCriteria}
              onSourceConditionsChange={setSourceConditions}
              onTargetCriteriaChange={setTargetCriteria}
            />
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose} disabled={updateMutation.isPending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
