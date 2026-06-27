<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Checkout\Subscriber;

use Meta\ClipCpq\Core\Checkout\Event\MetaClipConfigurationOrderedEvent;
use Meta\ClipCpq\Core\Lobster\Message\DispatchToLobsterMessage;
use Meta\ClipCpq\Core\Review\ReviewQueueService;
use Psr\Log\LoggerInterface;
use Shopware\Core\Framework\DataAbstractionLayer\EntityRepository;
use Shopware\Core\Framework\DataAbstractionLayer\Search\Criteria;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\Messenger\MessageBusInterface;

class OrderRoutingSubscriber implements EventSubscriberInterface
{
    /**
     * @param EntityRepository<\Meta\ClipCpq\Core\Content\Configuration\ConfigurationCollection> $configurationRepository
     */
    public function __construct(
        private readonly EntityRepository $configurationRepository,
        private readonly MessageBusInterface $messageBus,
        private readonly ReviewQueueService $reviewQueueService,
        private readonly LoggerInterface $logger
    ) {
    }

    public static function getSubscribedEvents(): array
    {
        return [
            MetaClipConfigurationOrderedEvent::class => 'onConfigurationOrdered',
        ];
    }

    public function onConfigurationOrdered(MetaClipConfigurationOrderedEvent $event): void
    {
        $criteria = new Criteria([$event->getConfigurationId()]);

        /** @var \Meta\ClipCpq\Core\Content\Configuration\ConfigurationEntity|null $configuration */
        $configuration = $this->configurationRepository->search($criteria, $event->getContext())->first();
        if ($configuration === null) {
            return;
        }

        $this->configurationRepository->update([
            [
                'id' => $configuration->getId(),
                'orderId' => $event->getOrderId(),
            ],
        ], $event->getContext());

        $route = $this->resolveRouteBucket($configuration->getConfigData());
        if (in_array($route, ['A', 'B'], true)) {
            $this->dispatchToLobster($configuration->getId(), $event->getOrderId(), $route, $event->getContext());

            return;
        }

        $this->queueForReview($configuration->getId(), $event->getOrderId(), $route, $event->getContext());
    }

    /**
     * @param array<string, mixed> $configurationData
     */
    private function resolveRouteBucket(array $configurationData): string
    {
        $candidate = $configurationData['routingLayer']
            ?? $configurationData['routingClass']
            ?? $configurationData['route']
            ?? $configurationData['reviewClass']
            ?? 'C';

        if (!is_string($candidate)) {
            return 'C';
        }

        $normalized = strtoupper(trim($candidate));

        return in_array($normalized, ['A', 'B', 'C'], true) ? $normalized : 'C';
    }

    private function dispatchToLobster(string $configurationId, string $orderId, string $route, \Shopware\Core\Framework\Context $context): void
    {
        $this->configurationRepository->update([
            [
                'id' => $configurationId,
                'validationStatus' => 'lobster_pending',
            ],
        ], $context);

        $this->messageBus->dispatch(new DispatchToLobsterMessage($configurationId, $orderId));

        $this->logger->info('MetaClip order routed to Lobster.', [
            'configurationId' => $configurationId,
            'orderId' => $orderId,
            'route' => $route,
        ]);
    }

    private function queueForReview(string $configurationId, string $orderId, string $route, \Shopware\Core\Framework\Context $context): void
    {
        $this->reviewQueueService->queueForReview($configurationId, $context);

        $this->logger->info('MetaClip order routed to review queue.', [
            'configurationId' => $configurationId,
            'orderId' => $orderId,
            'route' => $route,
        ]);
    }
}
