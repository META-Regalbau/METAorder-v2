<?php

declare(strict_types=1);

namespace Meta\CartSignal\Core\Message;

use Meta\CartSignal\Core\CartSignalSender;
use Meta\CartSignal\Subscriber\CartSignalSubscriber;
use Shopware\Core\System\SystemConfig\SystemConfigService;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

/** Versand aus der Message Queue; Fehler werden nur protokolliert, nichts wird wiederholt */
#[AsMessageHandler]
class CartSignalMessageHandler
{
    public function __construct(
        private readonly SystemConfigService $systemConfig,
        private readonly CartSignalSender $sender,
    ) {
    }

    public function __invoke(CartSignalMessage $message): void
    {
        $this->sender->send(CartSignalSubscriber::settings($this->systemConfig, $message->getSalesChannelId()), $message->getBody());
    }
}
