<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Checkout\Subscriber;

use Meta\ClipCpq\Core\Checkout\Event\MetaClipConfigurationOrderedEvent;
use Psr\Log\LoggerInterface;
use Shopware\Core\Checkout\Cart\Event\CheckoutOrderPlacedEvent;
use Symfony\Component\EventDispatcher\EventDispatcherInterface;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

class OrderPlacedSubscriber implements EventSubscriberInterface
{
    public function __construct(
        private readonly EventDispatcherInterface $eventDispatcher,
        private readonly LoggerInterface $logger
    ) {
    }

    public static function getSubscribedEvents(): array
    {
        return [
            CheckoutOrderPlacedEvent::class => 'onOrderPlaced',
        ];
    }

    public function onOrderPlaced(CheckoutOrderPlacedEvent $event): void
    {
        $order = $event->getOrder();
        $lineItems = $order->getLineItems();
        if ($lineItems === null) {
            return;
        }

        foreach ($lineItems as $lineItem) {
            $payload = $lineItem->getPayload() ?? [];
            $customFields = isset($payload['customFields']) && is_array($payload['customFields']) ? $payload['customFields'] : [];
            $configurationId = $payload['metaClipConfigurationId']
                ?? $payload['meta_clip_configuration_id']
                ?? $payload['configurationId']
                ?? $customFields['metaClipConfigurationId']
                ?? $customFields['meta_clip_configuration_id']
                ?? null;

            if (!is_string($configurationId) || $configurationId === '') {
                continue;
            }

            $this->eventDispatcher->dispatch(new MetaClipConfigurationOrderedEvent(
                $configurationId,
                $order->getId(),
                $event->getContext()
            ));

            $this->logger->info('MetaClip configuration order event dispatched.', [
                'configurationId' => $configurationId,
                'orderId' => $order->getId(),
            ]);
        }
    }
}
