import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { RuleCondition, RuleTargetCriteria } from "@shared/schema";

interface RuleBuilderProps {
  sourceConditions: RuleCondition[];
  targetCriteria: RuleTargetCriteria[];
  onSourceConditionsChange: (conditions: RuleCondition[]) => void;
  onTargetCriteriaChange: (criteria: RuleTargetCriteria[]) => void;
}

type ConditionType = 'property' | 'category' | 'dimension';
type OperatorType = 'equals' | 'contains' | 'greaterThan' | 'lessThan' | 'matchesDimensions' | 'sameDimensions';

export default function RuleBuilder({
  sourceConditions,
  targetCriteria,
  onSourceConditionsChange,
  onTargetCriteriaChange,
}: RuleBuilderProps) {
  const { t } = useTranslation();

  const addSourceCondition = () => {
    onSourceConditionsChange([
      ...sourceConditions,
      { type: 'property', operator: 'equals', key: '', value: '' },
    ]);
  };

  const updateSourceCondition = (index: number, field: keyof RuleCondition, value: string) => {
    const updated = [...sourceConditions];
    updated[index] = { ...updated[index], [field]: value };
    onSourceConditionsChange(updated);
  };

  const removeSourceCondition = (index: number) => {
    onSourceConditionsChange(sourceConditions.filter((_, i) => i !== index));
  };

  const addTargetCriterion = () => {
    onTargetCriteriaChange([
      ...targetCriteria,
      { type: 'property', operator: 'equals', key: '', value: '' },
    ]);
  };

  const updateTargetCriterion = (index: number, field: keyof RuleTargetCriteria, value: string) => {
    const updated = [...targetCriteria];
    updated[index] = { ...updated[index], [field]: value };
    onTargetCriteriaChange(updated);
  };

  const removeTargetCriterion = (index: number) => {
    onTargetCriteriaChange(targetCriteria.filter((_, i) => i !== index));
  };

  const renderConditionEditor = (
    condition: RuleCondition,
    index: number,
    onUpdate: (index: number, field: keyof RuleCondition, value: string) => void,
    onRemove: (index: number) => void,
    testIdPrefix: string
  ) => {
    const isDimensionOperator = condition.operator === 'matchesDimensions' || condition.operator === 'sameDimensions';
    
    return (
      <div key={index} className="flex gap-2 items-end">
        <div className="flex-1 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{t('ruleBuilder.type')}</Label>
              <Select
                value={condition.type}
                onValueChange={(value) => onUpdate(index, 'type', value)}
              >
                <SelectTrigger data-testid={`${testIdPrefix}-type-${index}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="property">{t('ruleBuilder.typeProperty')}</SelectItem>
                  <SelectItem value="category">{t('ruleBuilder.typeCategory')}</SelectItem>
                  <SelectItem value="dimension">{t('ruleBuilder.typeDimension')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">{t('ruleBuilder.operator')}</Label>
              <Select
                value={condition.operator}
                onValueChange={(value) => onUpdate(index, 'operator', value)}
              >
                <SelectTrigger data-testid={`${testIdPrefix}-operator-${index}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {condition.type === 'dimension' ? (
                    <>
                      <SelectItem value="matchesDimensions">{t('ruleBuilder.opMatchesDimensions')}</SelectItem>
                      <SelectItem value="sameDimensions">{t('ruleBuilder.opSameDimensions')}</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="equals">{t('ruleBuilder.opEquals')}</SelectItem>
                      <SelectItem value="contains">{t('ruleBuilder.opContains')}</SelectItem>
                      <SelectItem value="greaterThan">{t('ruleBuilder.opGreaterThan')}</SelectItem>
                      <SelectItem value="lessThan">{t('ruleBuilder.opLessThan')}</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isDimensionOperator && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">{t('ruleBuilder.key')}</Label>
                <Input
                  value={condition.key || ''}
                  onChange={(e) => onUpdate(index, 'key', e.target.value)}
                  placeholder={t('ruleBuilder.keyPlaceholder')}
                  data-testid={`${testIdPrefix}-key-${index}`}
                />
              </div>

              <div>
                <Label className="text-xs">{t('ruleBuilder.value')}</Label>
                <Input
                  value={condition.value || ''}
                  onChange={(e) => onUpdate(index, 'value', e.target.value)}
                  placeholder={t('ruleBuilder.valuePlaceholder')}
                  data-testid={`${testIdPrefix}-value-${index}`}
                />
              </div>
            </div>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onRemove(index)}
          data-testid={`${testIdPrefix}-remove-${index}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('ruleBuilder.sourceConditionsTitle')}</CardTitle>
          <CardDescription>{t('ruleBuilder.sourceConditionsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sourceConditions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('ruleBuilder.noConditions')}</p>
          ) : (
            sourceConditions.map((condition, index) =>
              renderConditionEditor(condition, index, updateSourceCondition, removeSourceCondition, 'source-condition')
            )
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addSourceCondition}
            data-testid="button-add-source-condition"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('ruleBuilder.addCondition')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('ruleBuilder.targetCriteriaTitle')}</CardTitle>
          <CardDescription>{t('ruleBuilder.targetCriteriaDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {targetCriteria.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('ruleBuilder.noCriteria')}</p>
          ) : (
            targetCriteria.map((criterion, index) =>
              renderConditionEditor(criterion, index, updateTargetCriterion, removeTargetCriterion, 'target-criterion')
            )
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addTargetCriterion}
            data-testid="button-add-target-criterion"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('ruleBuilder.addCriterion')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
