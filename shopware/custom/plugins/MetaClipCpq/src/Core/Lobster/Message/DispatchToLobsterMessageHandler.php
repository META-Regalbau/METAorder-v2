<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Lobster\Message;

use Meta\ClipCpq\Core\Content\Configuration\ConfigurationEntity;
use Meta\ClipCpq\Core\Lobster\LobsterDispatcher;
use Psr\Log\LoggerInterface;
use Shopware\Core\Checkout\Order\OrderCollection;
use Shopware\Core\Checkout\Order\OrderEntity;
use Shopware\Core\Framework\Context;
use Shopware\Core\Framework\DataAbstractionLayer\EntityRepository;
use Shopware\Core\Framework\DataAbstractionLayer\Search\Criteria;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler]
class DispatchToLobsterMessageHandler
{
    /**
     * @param EntityRepository<\Meta\ClipCpq\Core\Content\Configuration\ConfigurationCollection> $configurationRepository
     * @param EntityRepository<OrderCollection> $orderRepository
     */
    public function __construct(
        private readonly EntityRepository $configurationRepository,
        private readonly EntityRepository $orderRepository,
        private readonly LobsterDispatcher $lobsterDispatcher,
        private readonly LoggerInterface $logger
    ) {
    }

    public function __invoke(DispatchToLobsterMessage $message): void
    {
        $context = Context::createDefaultContext();
        $configuration = $this->loadConfiguration($message->getConfigurationId(), $context);
        $order = $this->loadOrder($message->getOrderId(), $context);

        try {
            $this->lobsterDispatcher->dispatch($order, $configuration);
            $this->configurationRepository->update([
                [
                    'id' => $configuration->getId(),
                    'validationStatus' => 'lobster_dispatched',
                    'outcome' => 'approved',
                    'completedAt' => new \DateTimeImmutable(),
                ],
            ], $context);
        } catch (\Throwable $exception) {
            $this->logger->error('Asynchronous Lobster dispatch failed.', [
                'configurationId' => $message->getConfigurationId(),
                'orderId' => $message->getOrderId(),
                'error' => $exception->getMessage(),
            ]);

            throw $exception;
        }
    }

    private function loadConfiguration(string $configurationId, Context $context): ConfigurationEntity
    {
        $criteria = new Criteria([$configurationId]);

        /** @var ConfigurationEntity|null $configuration */
        $configuration = $this->configurationRepository->search($criteria, $context)->first();
        if ($configuration === null) {
            throw new \RuntimeException(sprintf('Configuration "%s" not found.', $configurationId));
        }

        return $configuration;
    }

    private function loadOrder(string $orderId, Context $context): OrderEntity
    {
        $criteria = new Criteria([$orderId]);
        $criteria->addAssociation('lineItems');

        /** @var OrderEntity|null $order */
        $order = $this->orderRepository->search($criteria, $context)->first();
        if ($order === null) {
            throw new \RuntimeException(sprintf('Order "%s" not found.', $orderId));
        }

        return $order;
    }
}
