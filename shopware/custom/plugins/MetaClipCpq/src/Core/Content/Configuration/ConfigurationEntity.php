<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\Configuration;

use DateTimeInterface;
use Meta\ClipCpq\Core\Content\ConfigurationReviewLog\ConfigurationReviewLogCollection;
use Meta\ClipCpq\Core\Content\System\SystemEntity;
use Shopware\Core\Framework\DataAbstractionLayer\Entity;
use Shopware\Core\Framework\DataAbstractionLayer\EntityIdTrait;
use Shopware\Core\System\User\UserEntity;

class ConfigurationEntity extends Entity
{
    use EntityIdTrait;

    protected string $systemId;

    protected ?string $customerId = null;

    protected ?string $orderId = null;

    protected ?string $salesChannelId = null;

    protected string $name;

    /**
     * @var array<string, mixed>
     */
    protected array $configData = [];

    protected string $validationStatus;

    protected ?string $assignedTo = null;

    protected ?DateTimeInterface $assignedAt = null;

    protected ?DateTimeInterface $completedAt = null;

    protected ?string $outcome = null;

    protected ?string $notes = null;

    protected float $totalPrice;

    protected ?SystemEntity $system = null;

    protected ?UserEntity $assignedUser = null;

    protected ?ConfigurationReviewLogCollection $reviewLogs = null;

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

    public function getCustomerId(): ?string
    {
        return $this->customerId;
    }

    public function setCustomerId(?string $customerId): void
    {
        $this->customerId = $customerId;
    }

    public function getOrderId(): ?string
    {
        return $this->orderId;
    }

    public function setOrderId(?string $orderId): void
    {
        $this->orderId = $orderId;
    }

    public function getSalesChannelId(): ?string
    {
        return $this->salesChannelId;
    }

    public function setSalesChannelId(?string $salesChannelId): void
    {
        $this->salesChannelId = $salesChannelId;
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function setName(string $name): void
    {
        $this->name = $name;
    }

    /**
     * @return array<string, mixed>
     */
    public function getConfigData(): array
    {
        return $this->configData;
    }

    /**
     * @param array<string, mixed> $configData
     */
    public function setConfigData(array $configData): void
    {
        $this->configData = $configData;
    }

    public function getValidationStatus(): string
    {
        return $this->validationStatus;
    }

    public function setValidationStatus(string $validationStatus): void
    {
        $this->validationStatus = $validationStatus;
    }

    public function getAssignedTo(): ?string
    {
        return $this->assignedTo;
    }

    public function setAssignedTo(?string $assignedTo): void
    {
        $this->assignedTo = $assignedTo;
    }

    public function getAssignedAt(): ?DateTimeInterface
    {
        return $this->assignedAt;
    }

    public function setAssignedAt(?DateTimeInterface $assignedAt): void
    {
        $this->assignedAt = $assignedAt;
    }

    public function getCompletedAt(): ?DateTimeInterface
    {
        return $this->completedAt;
    }

    public function setCompletedAt(?DateTimeInterface $completedAt): void
    {
        $this->completedAt = $completedAt;
    }

    public function getOutcome(): ?string
    {
        return $this->outcome;
    }

    public function setOutcome(?string $outcome): void
    {
        $this->outcome = $outcome;
    }

    public function getNotes(): ?string
    {
        return $this->notes;
    }

    public function setNotes(?string $notes): void
    {
        $this->notes = $notes;
    }

    public function getTotalPrice(): float
    {
        return $this->totalPrice;
    }

    public function setTotalPrice(float $totalPrice): void
    {
        $this->totalPrice = $totalPrice;
    }

    public function getSystem(): ?SystemEntity
    {
        return $this->system;
    }

    public function setSystem(?SystemEntity $system): void
    {
        $this->system = $system;
    }

    public function getAssignedUser(): ?UserEntity
    {
        return $this->assignedUser;
    }

    public function setAssignedUser(?UserEntity $assignedUser): void
    {
        $this->assignedUser = $assignedUser;
    }

    public function getReviewLogs(): ?ConfigurationReviewLogCollection
    {
        return $this->reviewLogs;
    }

    public function setReviewLogs(?ConfigurationReviewLogCollection $reviewLogs): void
    {
        $this->reviewLogs = $reviewLogs;
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
