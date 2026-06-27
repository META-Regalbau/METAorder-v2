<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\ConfigurationReviewLog;

use DateTimeInterface;
use Meta\ClipCpq\Core\Content\Configuration\ConfigurationEntity;
use Shopware\Core\Framework\DataAbstractionLayer\Entity;
use Shopware\Core\Framework\DataAbstractionLayer\EntityIdTrait;
use Shopware\Core\System\User\UserEntity;

class ConfigurationReviewLogEntity extends Entity
{
    use EntityIdTrait;

    protected string $configurationId;

    protected ?string $actorUserId = null;

    protected ?string $fromStatus = null;

    protected string $toStatus;

    protected string $action;

    /**
     * @var array<string, mixed>|null
     */
    protected ?array $payload = null;

    protected ?ConfigurationEntity $configuration = null;

    protected ?UserEntity $actorUser = null;

    protected ?DateTimeInterface $createdAt = null;

    public function getConfigurationId(): string
    {
        return $this->configurationId;
    }

    public function setConfigurationId(string $configurationId): void
    {
        $this->configurationId = $configurationId;
    }

    public function getActorUserId(): ?string
    {
        return $this->actorUserId;
    }

    public function setActorUserId(?string $actorUserId): void
    {
        $this->actorUserId = $actorUserId;
    }

    public function getFromStatus(): ?string
    {
        return $this->fromStatus;
    }

    public function setFromStatus(?string $fromStatus): void
    {
        $this->fromStatus = $fromStatus;
    }

    public function getToStatus(): string
    {
        return $this->toStatus;
    }

    public function setToStatus(string $toStatus): void
    {
        $this->toStatus = $toStatus;
    }

    public function getAction(): string
    {
        return $this->action;
    }

    public function setAction(string $action): void
    {
        $this->action = $action;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getPayload(): ?array
    {
        return $this->payload;
    }

    /**
     * @param array<string, mixed>|null $payload
     */
    public function setPayload(?array $payload): void
    {
        $this->payload = $payload;
    }

    public function getConfiguration(): ?ConfigurationEntity
    {
        return $this->configuration;
    }

    public function setConfiguration(?ConfigurationEntity $configuration): void
    {
        $this->configuration = $configuration;
    }

    public function getActorUser(): ?UserEntity
    {
        return $this->actorUser;
    }

    public function setActorUser(?UserEntity $actorUser): void
    {
        $this->actorUser = $actorUser;
    }

    public function getCreatedAt(): ?DateTimeInterface
    {
        return $this->createdAt;
    }
}
