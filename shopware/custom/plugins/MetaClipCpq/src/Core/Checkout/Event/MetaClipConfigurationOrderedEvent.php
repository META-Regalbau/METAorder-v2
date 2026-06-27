<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Checkout\Event;

use Shopware\Core\Framework\Context;
use Symfony\Contracts\EventDispatcher\Event;

class MetaClipConfigurationOrderedEvent extends Event
{
    public function __construct(
        private readonly string $configurationId,
        private readonly string $orderId,
        private readonly Context $context
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

    public function getContext(): Context
    {
        return $this->context;
    }
}
