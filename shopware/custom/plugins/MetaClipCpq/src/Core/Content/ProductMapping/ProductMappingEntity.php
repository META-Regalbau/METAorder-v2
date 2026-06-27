<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\ProductMapping;

use DateTimeInterface;
use Meta\ClipCpq\Core\Content\ComponentType\ComponentTypeEntity;
use Meta\ClipCpq\Core\Content\Geometry\GeometryCollection;
use Meta\ClipCpq\Core\Content\System\SystemEntity;
use Shopware\Core\Framework\DataAbstractionLayer\Entity;
use Shopware\Core\Framework\DataAbstractionLayer\EntityIdTrait;

class ProductMappingEntity extends Entity
{
    use EntityIdTrait;

    protected string $shopwareProductId;

    protected string $shopwareProductNumber;

    protected string $systemId;

    protected string $componentTypeId;

    /**
     * @var array<string, mixed>|null
     */
    protected ?array $attributes = null;

    protected string $status;

    protected ?SystemEntity $system = null;

    protected ?ComponentTypeEntity $componentType = null;

    protected ?GeometryCollection $geometries = null;

    protected ?DateTimeInterface $createdAt = null;

    protected ?DateTimeInterface $updatedAt = null;

    public function getShopwareProductId(): string
    {
        return $this->shopwareProductId;
    }

    public function setShopwareProductId(string $shopwareProductId): void
    {
        $this->shopwareProductId = $shopwareProductId;
    }

    public function getShopwareProductNumber(): string
    {
        return $this->shopwareProductNumber;
    }

    public function setShopwareProductNumber(string $shopwareProductNumber): void
    {
        $this->shopwareProductNumber = $shopwareProductNumber;
    }

    public function getSystemId(): string
    {
        return $this->systemId;
    }

    public function setSystemId(string $systemId): void
    {
        $this->systemId = $systemId;
    }

    public function getComponentTypeId(): string
    {
        return $this->componentTypeId;
    }

    public function setComponentTypeId(string $componentTypeId): void
    {
        $this->componentTypeId = $componentTypeId;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getAttributes(): ?array
    {
        return $this->attributes;
    }

    /**
     * @param array<string, mixed>|null $attributes
     */
    public function setAttributes(?array $attributes): void
    {
        $this->attributes = $attributes;
    }

    public function getStatus(): string
    {
        return $this->status;
    }

    public function setStatus(string $status): void
    {
        $this->status = $status;
    }

    public function getSystem(): ?SystemEntity
    {
        return $this->system;
    }

    public function setSystem(?SystemEntity $system): void
    {
        $this->system = $system;
    }

    public function getComponentType(): ?ComponentTypeEntity
    {
        return $this->componentType;
    }

    public function setComponentType(?ComponentTypeEntity $componentType): void
    {
        $this->componentType = $componentType;
    }

    public function getGeometries(): ?GeometryCollection
    {
        return $this->geometries;
    }

    public function setGeometries(?GeometryCollection $geometries): void
    {
        $this->geometries = $geometries;
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
