<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\RuleVersion;

use DateTimeInterface;
use Meta\ClipCpq\Core\Content\Rule\RuleEntity;
use Shopware\Core\Framework\DataAbstractionLayer\Entity;
use Shopware\Core\Framework\DataAbstractionLayer\EntityIdTrait;

class RuleVersionEntity extends Entity
{
    use EntityIdTrait;

    protected string $ruleId;

    protected int $version;

    /**
     * @var array<string, mixed>
     */
    protected array $condition = [];

    /**
     * @var array<string, mixed>
     */
    protected array $action = [];

    protected ?string $changedBy = null;

    protected ?string $changeNote = null;

    protected ?RuleEntity $rule = null;

    protected ?DateTimeInterface $changedAt = null;

    protected ?DateTimeInterface $updatedAt = null;

    public function getRuleId(): string
    {
        return $this->ruleId;
    }

    public function setRuleId(string $ruleId): void
    {
        $this->ruleId = $ruleId;
    }

    public function getVersion(): int
    {
        return $this->version;
    }

    public function setVersion(int $version): void
    {
        $this->version = $version;
    }

    /**
     * @return array<string, mixed>
     */
    public function getCondition(): array
    {
        return $this->condition;
    }

    /**
     * @param array<string, mixed> $condition
     */
    public function setCondition(array $condition): void
    {
        $this->condition = $condition;
    }

    /**
     * @return array<string, mixed>
     */
    public function getAction(): array
    {
        return $this->action;
    }

    /**
     * @param array<string, mixed> $action
     */
    public function setAction(array $action): void
    {
        $this->action = $action;
    }

    public function getChangedBy(): ?string
    {
        return $this->changedBy;
    }

    public function setChangedBy(?string $changedBy): void
    {
        $this->changedBy = $changedBy;
    }

    public function getChangeNote(): ?string
    {
        return $this->changeNote;
    }

    public function setChangeNote(?string $changeNote): void
    {
        $this->changeNote = $changeNote;
    }

    public function getRule(): ?RuleEntity
    {
        return $this->rule;
    }

    public function setRule(?RuleEntity $rule): void
    {
        $this->rule = $rule;
    }

    public function getChangedAt(): ?DateTimeInterface
    {
        return $this->changedAt;
    }

    public function getUpdatedAt(): ?DateTimeInterface
    {
        return $this->updatedAt;
    }
}
