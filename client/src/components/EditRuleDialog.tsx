import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CrossSellingRule } from "@shared/schema";

interface EditRuleDialogProps {
  rule: CrossSellingRule | null;
  open: boolean;
  onClose: () => void;
}

export default function EditRuleDialog({ rule, open, onClose }: EditRuleDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);

  // Update form when rule changes
  useEffect(() => {
    if (rule) {
      setName(rule.name);
      setDescription(rule.description || "");
      setActive(rule.active);
    }
  }, [rule]);

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest(`/api/cross-selling-rules/${rule!.id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling-rules"] });
      toast({
        title: t('rules.updated'),
        description: t('rules.updatedDescription'),
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: t('rules.updateError'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!name.trim()) {
      toast({
        title: t('errors.validationFailed'),
        description: t('rules.nameRequired'),
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      active: active,
    });
  };

  if (!rule) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-edit-rule">
        <DialogHeader>
          <DialogTitle>{t('rules.edit')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">{t('rules.name')}</Label>
            <Input
              id="edit-name"
              placeholder={t('rules.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-rule-name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-description">{t('rules.description')}</Label>
            <Textarea
              id="edit-description"
              placeholder={t('rules.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              data-testid="input-rule-description"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="edit-active">{t('rules.status')}</Label>
              <p className="text-sm text-muted-foreground">
                {active ? t('rules.active') : t('rules.inactive')}
              </p>
            </div>
            <Switch
              id="edit-active"
              checked={active}
              onCheckedChange={setActive}
              data-testid="switch-active"
            />
          </div>

          <div className="bg-muted p-4 rounded-md">
            <p className="text-sm font-medium mb-2">{t('rules.conditionsSummary')}</p>
            <p className="text-sm text-muted-foreground">
              {rule.sourceConditions.length} {t('rules.sourceConditions')},{' '}
              {rule.targetCriteria.length} {t('rules.targetCriteria')}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {t('rules.editConditionsHint')}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={updateMutation.isPending}
            data-testid="button-cancel"
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={updateMutation.isPending}
            data-testid="button-save"
          >
            {updateMutation.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
