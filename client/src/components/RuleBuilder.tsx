import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { RuleCondition, RuleTargetCriteria, RuleConditionOperator } from "@shared/schema";

interface RuleBuilderProps {
  sourceConditions: RuleCondition[];
  targetCriteria: RuleTargetCriteria[];
  onSourceConditionsChange: (conditions: RuleCondition[]) => void;
  onTargetCriteriaChange: (criteria: RuleTargetCriteria[]) => void;
}

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
      { field: '', operator: 'equals', value: '' },
    ]);
  };

  const updateSourceCondition = (index: number, updates: Partial<RuleCondition>) => {
    const updated = [...sourceConditions];
    updated[index] = { ...updated[index], ...updates };
    onSourceConditionsChange(updated);
  };

  const removeSourceCondition = (index: number) => {
    onSourceConditionsChange(sourceConditions.filter((_, i) => i !== index));
  };

  const addTargetCriterion = () => {
    onTargetCriteriaChange([
      ...targetCriteria,
      { field: '', matchType: 'exact', value: '' },
    ]);
  };

  const updateTargetCriterion = (index: number, updates: Partial<RuleTargetCriteria>) => {
    const updated = [...targetCriteria];
    updated[index] = { ...updated[index], ...updates };
    onTargetCriteriaChange(updated);
  };

  const removeTargetCriterion = (index: number) => {
    onTargetCriteriaChange(targetCriteria.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      {/* Source Conditions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('ruleBuilder.sourceConditionsTitle')}</CardTitle>
          <CardDescription>{t('ruleBuilder.sourceConditionsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sourceConditions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('ruleBuilder.noConditions')}</p>
          ) : (
            sourceConditions.map((condition, index) => (
              <div key={index} className="flex gap-2 items-end">
                <div className="flex-1 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">{t('ruleBuilder.field')}</Label>
                      <Input
                        value={condition.field}
                        onChange={(e) => updateSourceCondition(index, { field: e.target.value })}
                        placeholder={t('ruleBuilder.fieldPlaceholder')}
                        data-testid={`input-source-field-${index}`}
                      />
                    </div>

                    <div>
                      <Label className="text-xs">{t('ruleBuilder.operator')}</Label>
                      <Select
                        value={condition.operator}
                        onValueChange={(value) => updateSourceCondition(index, { operator: value as RuleConditionOperator })}
                      >
                        <SelectTrigger data-testid={`select-source-operator-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="equals">{t('ruleBuilder.opEquals')}</SelectItem>
                          <SelectItem value="notEquals">{t('ruleBuilder.opNotEquals')}</SelectItem>
                          <SelectItem value="contains">{t('ruleBuilder.opContains')}</SelectItem>
                          <SelectItem value="notContains">{t('ruleBuilder.opNotContains')}</SelectItem>
                          <SelectItem value="greaterThan">{t('ruleBuilder.opGreaterThan')}</SelectItem>
                          <SelectItem value="lessThan">{t('ruleBuilder.opLessThan')}</SelectItem>
                          <SelectItem value="greaterThanOrEqual">{t('ruleBuilder.opGreaterThanOrEqual')}</SelectItem>
                          <SelectItem value="lessThanOrEqual">{t('ruleBuilder.opLessThanOrEqual')}</SelectItem>
                          <SelectItem value="matchesDimensions">{t('ruleBuilder.opMatchesDimensions')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">{t('ruleBuilder.value')}</Label>
                    <Input
                      value={String(condition.value || '')}
                      onChange={(e) => updateSourceCondition(index, { value: e.target.value })}
                      placeholder={t('ruleBuilder.valuePlaceholder')}
                      data-testid={`input-source-value-${index}`}
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeSourceCondition(index)}
                  data-testid={`button-remove-source-${index}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
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

      {/* Target Criteria */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('ruleBuilder.targetCriteriaTitle')}</CardTitle>
          <CardDescription>{t('ruleBuilder.targetCriteriaDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {targetCriteria.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('ruleBuilder.noCriteria')}</p>
          ) : (
            targetCriteria.map((criterion, index) => (
              <div key={index} className="flex gap-2 items-end">
                <div className="flex-1 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">{t('ruleBuilder.field')}</Label>
                      <Input
                        value={criterion.field}
                        onChange={(e) => updateTargetCriterion(index, { field: e.target.value })}
                        placeholder={t('ruleBuilder.fieldPlaceholder')}
                        data-testid={`input-target-field-${index}`}
                      />
                    </div>

                    <div>
                      <Label className="text-xs">{t('ruleBuilder.matchType')}</Label>
                      <Select
                        value={criterion.matchType}
                        onValueChange={(value) => updateTargetCriterion(index, { matchType: value as 'exact' | 'contains' | 'sameDimensions' | 'sameProperty' })}
                      >
                        <SelectTrigger data-testid={`select-target-matchtype-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="exact">{t('ruleBuilder.matchExact')}</SelectItem>
                          <SelectItem value="contains">{t('ruleBuilder.matchContains')}</SelectItem>
                          <SelectItem value="sameDimensions">{t('ruleBuilder.matchSameDimensions')}</SelectItem>
                          <SelectItem value="sameProperty">{t('ruleBuilder.matchSameProperty')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">{t('ruleBuilder.value')}</Label>
                    <Input
                      value={String(criterion.value || '')}
                      onChange={(e) => updateTargetCriterion(index, { value: e.target.value })}
                      placeholder={t('ruleBuilder.valueOptionalPlaceholder')}
                      data-testid={`input-target-value-${index}`}
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeTargetCriterion(index)}
                  data-testid={`button-remove-target-${index}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
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
