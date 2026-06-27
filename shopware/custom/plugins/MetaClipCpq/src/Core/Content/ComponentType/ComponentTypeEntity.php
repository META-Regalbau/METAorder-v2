<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\ComponentType;

use DateTimeInterface;
use Meta\ClipCpq\Core\Content\ProductMapping\ProductMappingCollection;
use Meta\ClipCpq\Core\Content\System\SystemEntity;
use Shopware\Core\Framework\DataAbstractionLayer\Entity;
use Shopware\Core\Framework\DataAbstractionLayer\EntityIdTrait;

class ComponentTypeEntity extends Entity
{
    use EntityIdTrait;

    protected string $systemId;

    protected string $name;

    protected string $role;

    protected bool $required;

    protected int $sortOrder;

    protected ?string $icon = null;

    /**
     * @var array<string, mixed>|null
     */
    protected ?array $attributeSchema = null;

    protected ?SystemEntity $system = null;

    protected ?ProductMappingCollection $productMappings = null;

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

    public function getRole(): string
    {
        return $this->role;
    }

    public function setRole(string $role): void
    {
        $this->role = $role;
    }

    public function isRequired(): bool
    {
        return $this->required;
    }

    public function setRequired(bool $required): void
    {
        $this->required = $required;
    }

    public function getSortOrder(): int
    {
        return $this->sortOrder;
    }

    public function setSortOrder(int $sortOrder): void
    {
        $this->sortOrder = $sortOrder;
    }

    public function getIcon(): ?string
    {
        return $this->icon;
    }

    public function setIcon(?string $icon): void
    {
        $this->icon = $icon;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getAttributeSchema(): ?array
    {
        return $this->attributeSchema;
    }

    /**
     * @param array<string, mixed>|null $attributeSchema
     */
    public function setAttributeSchema(?array $attributeSchema): void
    {
        $this->attributeSchema = $attributeSchema;
    }

    public function getSystem(): ?SystemEntity
    {
        return $this->system;
    }

    public function setSystem(?SystemEntity $system): void
    {
        $this->system = $system;
    }

    public function getProductMappings(): ?ProductMappingCollection
    {
        return $this->productMappings;
    }

    public function setProductMappings(?ProductMappingCollection $productMappings): void
    {
        $this->productMappings = $productMappings;
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
