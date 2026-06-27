<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\System;

use DateTimeInterface;
use Meta\ClipCpq\Core\Content\ComponentType\ComponentTypeCollection;
use Meta\ClipCpq\Core\Content\Configuration\ConfigurationCollection;
use Meta\ClipCpq\Core\Content\ProductMapping\ProductMappingCollection;
use Meta\ClipCpq\Core\Content\Rule\RuleCollection;
use Shopware\Core\Framework\DataAbstractionLayer\Entity;
use Shopware\Core\Framework\DataAbstractionLayer\EntityIdTrait;

class SystemEntity extends Entity
{
    use EntityIdTrait;

    protected string $name;

    protected string $slug;

    protected ?string $description = null;

    protected string $status;

    protected ?ComponentTypeCollection $componentTypes = null;

    protected ?ProductMappingCollection $productMappings = null;

    protected ?RuleCollection $rules = null;

    protected ?ConfigurationCollection $configurations = null;

    protected ?DateTimeInterface $createdAt = null;

    protected ?DateTimeInterface $updatedAt = null;

    public function getName(): string
    {
        return $this->name;
    }

    public function setName(string $name): void
    {
        $this->name = $name;
    }

    public function getSlug(): string
    {
        return $this->slug;
    }

    public function setSlug(string $slug): void
    {
        $this->slug = $slug;
    }

    public function getDescription(): ?string
    {
        return $this->description;
    }

    public function setDescription(?string $description): void
    {
        $this->description = $description;
    }

    public function getStatus(): string
    {
        return $this->status;
    }

    public function setStatus(string $status): void
    {
        $this->status = $status;
    }

    public function getComponentTypes(): ?ComponentTypeCollection
    {
        return $this->componentTypes;
    }

    public function setComponentTypes(?ComponentTypeCollection $componentTypes): void
    {
        $this->componentTypes = $componentTypes;
    }

    public function getProductMappings(): ?ProductMappingCollection
    {
        return $this->productMappings;
    }

    public function setProductMappings(?ProductMappingCollection $productMappings): void
    {
        $this->productMappings = $productMappings;
    }

    public function getRules(): ?RuleCollection
    {
        return $this->rules;
    }

    public function setRules(?RuleCollection $rules): void
    {
        $this->rules = $rules;
    }

    public function getConfigurations(): ?ConfigurationCollection
    {
        return $this->configurations;
    }

    public function setConfigurations(?ConfigurationCollection $configurations): void
    {
        $this->configurations = $configurations;
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
