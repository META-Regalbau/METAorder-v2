import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AddRuleDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function AddRuleDialog({ open, onClose }: AddRuleDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/cross-selling-rules", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling-rules"] });
      toast({
        title: t('rules.created'),
        description: t('rules.createdDescription'),
      });
      handleClose();
    },
    onError: (error: any) => {
      toast({
        title: t('rules.createError'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    setName("");
    setDescription("");
    onClose();
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      toast({
        title: t('errors.validationFailed'),
        description: t('rules.nameRequired'),
        variant: "destructive",
      });
      return;
    }

    // Create a simple default rule (can be extended with RuleBuilder later)
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      active: 1, // 1 = active, 0 = inactive
      sourceConditions: [], // Empty for now - will be filled via Edit
      targetCriteria: [],   // Empty for now - will be filled via Edit
    });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-add-rule">
        <DialogHeader>
          <DialogTitle>{t('rules.createNew')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t('rules.name')}</Label>
            <Input
              id="name"
              placeholder={t('rules.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-rule-name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t('rules.description')}</Label>
            <Textarea
              id="description"
              placeholder={t('rules.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              data-testid="input-rule-description"
            />
          </div>

          <p className="text-sm text-muted-foreground">
            {t('rules.createHint')}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={createMutation.isPending}
            data-testid="button-cancel"
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            data-testid="button-create"
          >
            {createMutation.isPending ? t('common.creating') : t('common.create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
