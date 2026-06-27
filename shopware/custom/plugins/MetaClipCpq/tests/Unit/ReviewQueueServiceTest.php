<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Tests\Unit;

use Doctrine\DBAL\Connection;
use Meta\ClipCpq\Core\Content\Configuration\ConfigurationEntity;
use Meta\ClipCpq\Core\Lobster\Message\DispatchToLobsterMessage;
use Meta\ClipCpq\Core\Notification\SlackNotifier;
use Meta\ClipCpq\Core\Review\Exception\InvalidStatusTransitionException;
use Meta\ClipCpq\Core\Review\ReviewQueueService;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Shopware\Core\Content\Mail\Service\AbstractMailService;
use Shopware\Core\Framework\Context;
use Shopware\Core\Framework\DataAbstractionLayer\EntityRepository;
use Shopware\Core\Framework\DataAbstractionLayer\Search\EntitySearchResult;
use Shopware\Core\System\StateMachine\StateMachineRegistry;
use Symfony\Component\Messenger\MessageBusInterface;

class ReviewQueueServiceTest extends TestCase
{
    public function testApproveDispatchesAsyncLobsterMessage(): void
    {
        $context = Context::createDefaultContext();
        $initial = new ConfigurationEntity();
        $initial->assign([
            'id' => 'cfg-id',
            'name' => 'Cfg',
            'validationStatus' => ReviewQueueService::STATUS_ASSIGNED,
            'orderId' => 'order-id',
            'configData' => [],
            'totalPrice' => 10.0,
        ]);
        $updated = new ConfigurationEntity();
        $updated->assign([
            'id' => 'cfg-id',
            'name' => 'Cfg',
            'validationStatus' => ReviewQueueService::STATUS_APPROVED,
            'orderId' => 'order-id',
            'configData' => [],
            'totalPrice' => 10.0,
        ]);

        $searchFirst = $this->createMock(EntitySearchResult::class);
        $searchFirst->method('first')->willReturn($initial);
        $searchSecond = $this->createMock(EntitySearchResult::class);
        $searchSecond->method('first')->willReturn($updated);

        $configurationRepo = $this->createMock(EntityRepository::class);
        $configurationRepo->method('search')->willReturnOnConsecutiveCalls($searchFirst, $searchSecond);
        $configurationRepo->expects(static::once())->method('update');

        $reviewLogRepo = $this->createMock(EntityRepository::class);
        $reviewLogRepo->expects(static::once())->method('create');

        $bus = $this->createMock(MessageBusInterface::class);
        $bus->expects(static::once())
            ->method('dispatch')
            ->with(static::isInstanceOf(DispatchToLobsterMessage::class));

        $mailService = $this->createMock(AbstractMailService::class);
        $mailService->expects(static::never())->method('send');

        $connection = $this->createMock(Connection::class);
        $connection->method('fetchOne')->willReturn(false);

        $service = new ReviewQueueService(
            $configurationRepo,
            $reviewLogRepo,
            $bus,
            $this->createMock(SlackNotifier::class),
            $mailService,
            $connection,
            $this->createMock(StateMachineRegistry::class),
            new NullLogger()
        );

        $service->approve('cfg-id', 'user-id', 'ok', $context);
    }

    public function testRejectToApproveTransitionThrowsException(): void
    {
        $context = Context::createDefaultContext();
        $initial = new ConfigurationEntity();
        $initial->assign([
            'id' => 'cfg-id',
            'name' => 'Cfg',
            'validationStatus' => ReviewQueueService::STATUS_REJECTED,
            'configData' => [],
            'totalPrice' => 10.0,
        ]);

        $search = $this->createMock(EntitySearchResult::class);
        $search->method('first')->willReturn($initial);

        $configurationRepo = $this->createMock(EntityRepository::class);
        $configurationRepo->method('search')->willReturn($search);

        $service = new ReviewQueueService(
            $configurationRepo,
            $this->createMock(EntityRepository::class),
            $this->createMock(MessageBusInterface::class),
            $this->createMock(SlackNotifier::class),
            $this->createMock(AbstractMailService::class),
            $this->createMock(Connection::class),
            $this->createMock(StateMachineRegistry::class),
            new NullLogger()
        );

        $this->expectException(InvalidStatusTransitionException::class);
        $service->approve('cfg-id', 'user-id', null, $context);
    }
}
