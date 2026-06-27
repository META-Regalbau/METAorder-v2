<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Tests\Integration;

use Meta\ClipCpq\Core\Checkout\Event\MetaClipConfigurationOrderedEvent;
use Meta\ClipCpq\Core\Checkout\Subscriber\OrderRoutingSubscriber;
use Meta\ClipCpq\Core\Content\Configuration\ConfigurationEntity;
use Meta\ClipCpq\Core\Lobster\Message\DispatchToLobsterMessage;
use Meta\ClipCpq\Core\Review\ReviewQueueService;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Shopware\Core\Framework\Context;
use Shopware\Core\Framework\DataAbstractionLayer\EntityRepository;
use Shopware\Core\Framework\DataAbstractionLayer\Search\EntitySearchResult;
use Symfony\Component\Messenger\MessageBusInterface;

class OrderRoutingSmokeTest extends TestCase
{
    public function testRouteAQueuesAsyncLobsterDispatch(): void
    {
        $configuration = new ConfigurationEntity();
        $configuration->assign([
            'id' => 'cfg-id',
            'name' => 'Config',
            'validationStatus' => 'new',
            'configData' => ['routingLayer' => 'A'],
            'totalPrice' => 100.0,
        ]);

        $search = $this->createMock(EntitySearchResult::class);
        $search->method('first')->willReturn($configuration);

        $configurationRepo = $this->createMock(EntityRepository::class);
        $configurationRepo->method('search')->willReturn($search);
        $configurationRepo->expects(static::exactly(2))->method('update');

        $bus = $this->createMock(MessageBusInterface::class);
        $bus->expects(static::once())->method('dispatch')->with(static::isInstanceOf(DispatchToLobsterMessage::class));

        $reviewService = $this->createMock(ReviewQueueService::class);
        $reviewService->expects(static::never())->method('queueForReview');

        $subscriber = new OrderRoutingSubscriber($configurationRepo, $bus, $reviewService, new NullLogger());
        $subscriber->onConfigurationOrdered(new MetaClipConfigurationOrderedEvent('cfg-id', 'order-id', Context::createDefaultContext()));
    }

    public function testRouteCRoutesToReviewQueue(): void
    {
        $configuration = new ConfigurationEntity();
        $configuration->assign([
            'id' => 'cfg-id',
            'name' => 'Config',
            'validationStatus' => 'new',
            'configData' => ['routingLayer' => 'C'],
            'totalPrice' => 100.0,
        ]);

        $search = $this->createMock(EntitySearchResult::class);
        $search->method('first')->willReturn($configuration);

        $configurationRepo = $this->createMock(EntityRepository::class);
        $configurationRepo->method('search')->willReturn($search);
        $configurationRepo->expects(static::once())->method('update');

        $reviewService = $this->createMock(ReviewQueueService::class);
        $reviewService->expects(static::once())->method('queueForReview')->with('cfg-id');

        $subscriber = new OrderRoutingSubscriber(
            $configurationRepo,
            $this->createMock(MessageBusInterface::class),
            $reviewService,
            new NullLogger()
        );
        $subscriber->onConfigurationOrdered(new MetaClipConfigurationOrderedEvent('cfg-id', 'order-id', Context::createDefaultContext()));
    }
}
