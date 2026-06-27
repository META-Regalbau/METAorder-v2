<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\Geometry;

use DateTimeInterface;
use Meta\ClipCpq\Core\Content\ProductMapping\ProductMappingEntity;
use Shopware\Core\Framework\DataAbstractionLayer\Entity;
use Shopware\Core\Framework\DataAbstractionLayer\EntityIdTrait;

class GeometryEntity extends Entity
{
    use EntityIdTrait;

    protected string $productMappingId;

    /**
     * @var array<string, mixed>|null
     */
    protected ?array $origin = null;

    /**
     * @var array<int, array<string, mixed>>|null
     */
    protected ?array $anchorPoints = null;

    /**
     * @var array<string, mixed>|null
     */
    protected ?array $boundingBox = null;

    protected ?string $glbAssetUrl = null;

    /**
     * @var array<string, mixed>|null
     */
    protected ?array $lodLevels = null;

    protected ?ProductMappingEntity $productMapping = null;

    protected ?DateTimeInterface $createdAt = null;

    protected ?DateTimeInterface $updatedAt = null;

    public function getProductMappingId(): string
    {
        return $this->productMappingId;
    }

    public function setProductMappingId(string $productMappingId): void
    {
        $this->productMappingId = $productMappingId;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getOrigin(): ?array
    {
        return $this->origin;
    }

    /**
     * @param array<string, mixed>|null $origin
     */
    public function setOrigin(?array $origin): void
    {
        $this->origin = $origin;
    }

    /**
     * @return array<int, array<string, mixed>>|null
     */
    public function getAnchorPoints(): ?array
    {
        return $this->anchorPoints;
    }

    /**
     * @param array<int, array<string, mixed>>|null $anchorPoints
     */
    public function setAnchorPoints(?array $anchorPoints): void
    {
        $this->anchorPoints = $anchorPoints;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getBoundingBox(): ?array
    {
        return $this->boundingBox;
    }

    /**
     * @param array<string, mixed>|null $boundingBox
     */
    public function setBoundingBox(?array $boundingBox): void
    {
        $this->boundingBox = $boundingBox;
    }

    public function getGlbAssetUrl(): ?string
    {
        return $this->glbAssetUrl;
    }

    public function setGlbAssetUrl(?string $glbAssetUrl): void
    {
        $this->glbAssetUrl = $glbAssetUrl;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getLodLevels(): ?array
    {
        return $this->lodLevels;
    }

    /**
     * @param array<string, mixed>|null $lodLevels
     */
    public function setLodLevels(?array $lodLevels): void
    {
        $this->lodLevels = $lodLevels;
    }

    public function getProductMapping(): ?ProductMappingEntity
    {
        return $this->productMapping;
    }

    public function setProductMapping(?ProductMappingEntity $productMapping): void
    {
        $this->productMapping = $productMapping;
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
