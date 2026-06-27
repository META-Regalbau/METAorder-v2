<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\Rule;

use DateTimeInterface;
use Meta\ClipCpq\Core\Content\RuleVersion\RuleVersionCollection;
use Meta\ClipCpq\Core\Content\System\SystemEntity;
use Shopware\Core\Framework\DataAbstractionLayer\Entity;
use Shopware\Core\Framework\DataAbstractionLayer\EntityIdTrait;

class RuleEntity extends Entity
{
    use EntityIdTrait;

    protected string $systemId;

    protected string $name;

    protected string $type;

    protected int $priority;

    /**
     * @var array<string, mixed>
     */
    protected array $condition = [];

    /**
     * @var array<string, mixed>
     */
    protected array $action = [];

    /**
     * @var array<string, mixed>|null
     */
    protected ?array $fallback = null;

    protected ?string $message = null;

    protected string $status;

    protected int $version;

    protected ?string $createdBy = null;

    protected ?string $technicalKey = null;

    protected ?SystemEntity $system = null;

    protected ?RuleVersionCollection $versions = null;

    protected ?DateTimeInterface $createdAt = null;

    protected ?DateTimeInterface $updatedAt = null;

    public function getSystemId(): string
    {
        return $this->systemId;
    }

    public function setSystemId(string $systemId): void
    {
        $this->systemId = $systemId;
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function setName(string $name): void
    {
        $this->name = $name;
    }

    public function getType(): string
    {
        return $this->type;
    }

    public function setType(string $type): void
    {
        $this->type = $type;
    }

    public function getPriority(): int
    {
        return $this->priority;
    }

    public function setPriority(int $priority): void
    {
        $this->priority = $priority;
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

    /**
     * @return array<string, mixed>|null
     */
    public function getFallback(): ?array
    {
        return $this->fallback;
    }

    /**
     * @param array<string, mixed>|null $fallback
     */
    public function setFallback(?array $fallback): void
    {
        $this->fallback = $fallback;
    }

    public function getMessage(): ?string
    {
        return $this->message;
    }

    public function setMessage(?string $message): void
    {
        $this->message = $message;
    }

    public function getStatus(): string
    {
        return $this->status;
    }

    public function setStatus(string $status): void
    {
        $this->status = $status;
    }

    public function getVersion(): int
    {
        return $this->version;
    }

    public function setVersion(int $version): void
    {
        $this->version = $version;
    }

    public function getCreatedBy(): ?string
    {
        return $this->createdBy;
    }

    public function setCreatedBy(?string $createdBy): void
    {
        $this->createdBy = $createdBy;
    }

    public function getTechnicalKey(): ?string
    {
        return $this->technicalKey;
    }

    public function setTechnicalKey(?string $technicalKey): void
    {
        $this->technicalKey = $technicalKey;
    }

    public function getSystem(): ?SystemEntity
    {
        return $this->system;
    }

    public function setSystem(?SystemEntity $system): void
    {
        $this->system = $system;
    }

    public function getVersions(): ?RuleVersionCollection
    {
        return $this->versions;
    }

    public function setVersions(?RuleVersionCollection $versions): void
    {
        $this->versions = $versions;
    }

    public function getCreatedAt(): ?DateTimeInterface
    {
        return $this->createdAt;
    }

    public function getUpdatedAt(): ?DateTimeInterface
    {
        return $this->updatedAt;
    }
}
