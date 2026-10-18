<?php

declare(strict_types=1);

namespace Meta\CartSignal\Core\Message;

use Shopware\Core\Framework\MessageQueue\AsyncMessageInterface;

/** Fertige Meldung (JSON) für den Versand über die Message Queue */
class CartSignalMessage implements AsyncMessageInterface
{
    public function __construct(
        private readonly string $body,
        private readonly ?string $salesChannelId,
    ) {
    }

    public function getBody(): string
    {
        return $this->body;
    }

    public function getSalesChannelId(): ?string
    {
        return $this->salesChannelId;
    }
}
