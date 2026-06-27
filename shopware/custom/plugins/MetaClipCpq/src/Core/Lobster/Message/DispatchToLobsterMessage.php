<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Lobster\Message;

use Symfony\Component\Messenger\Attribute\AsMessage;

#[AsMessage('async')]
class DispatchToLobsterMessage
{
    public function __construct(
        private readonly string $configurationId,
        private readonly string $orderId
    ) {
    }

    public function getConfigurationId(): string
    {
        return $this->configurationId;
    }

    public function getOrderId(): string
    {
        return $this->orderId;
    }
}
