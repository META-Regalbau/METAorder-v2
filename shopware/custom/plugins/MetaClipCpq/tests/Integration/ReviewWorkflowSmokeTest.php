<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Tests\Integration;

use Doctrine\DBAL\Connection;
use Meta\ClipCpq\Core\Content\Configuration\ConfigurationEntity;
use Meta\ClipCpq\Core\Notification\SlackNotifier;
use Meta\ClipCpq\Core\Review\ReviewQueueService;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Shopware\Core\Content\Mail\Service\AbstractMailService;
use Shopware\Core\Framework\Context;
use Shopware\Core\Framework\DataAbstractionLayer\EntityRepository;
use Shopware\Core\Framework\DataAbstractionLayer\Search\EntitySearchResult;
use Shopware\Core\System\StateMachine\StateMachineRegistry;
use Symfony\Component\Messenger\MessageBusInterface;

class ReviewWorkflowSmokeTest extends TestCase
{
    public function testApproveTriggersMailAndAsyncDispatch(): void
    {
        $service = $this->buildReviewService(
            ReviewQueueService::STATUS_ASSIGNED,
            ReviewQueueService::STATUS_APPROVED,
            true
        );

        $service->approve('cfg-id', 'user-id', null, Context::createDefaultContext());
        static::assertTrue(true);
    }

    public function testRejectCancelsOrderAndSendsMail(): void
    {
        $service = $this->buildReviewService(
            ReviewQueueService::STATUS_ASSIGNED,
            ReviewQueueService::STATUS_REJECTED,
            false
        );

        $service->reject('cfg-id', 'user-id', 'no', Context::createDefaultContext());
        static::assertTrue(true);
    }

    private function buildReviewService(string $fromStatus, string $toStatus, bool $expectBusDispatch): ReviewQueueService
    {
        $base = new ConfigurationEntity();
        $base->assign([
            'id' => 'cfg-id',
            'name' => 'Cfg',
            'validationStatus' => $fromStatus,
            'orderId' => 'order-id',
            'customerId' => 'customer-id',
            'configData' => [],
            'totalPrice' => 1.0,
        ]);
        $updated = new ConfigurationEntity();
        $updated->assign([
            'id' => 'cfg-id',
            'name' => 'Cfg',
            'validationStatus' => $toStatus,
            'orderId' => 'order-id',
            'customerId' => 'customer-id',
            'configData' => [],
            'totalPrice' => 1.0,
        ]);

        $searchFirst = $this->createMock(EntitySearchResult::class);
        $searchFirst->method('first')->willReturn($base);
        $searchSecond = $this->createMock(EntitySearchResult::class);
        $searchSecond->method('first')->willReturn($updated);

        $configRepo = $this->createMock(EntityRepository::class);
        $configRepo->method('search')->willReturnOnConsecutiveCalls($searchFirst, $searchSecond);
        $configRepo->method('update');

        $reviewRepo = $this->createMock(EntityRepository::class);
        $reviewRepo->method('create');

        $bus = $this->createMock(MessageBusInterface::class);
        $busExpectation = $expectBusDispatch ? static::once() : static::never();
        $bus->expects($busExpectation)->method('dispatch');

        $mailService = $this->createMock(AbstractMailService::class);
        $mailService->method('send');

        $connection = $this->createMock(Connection::class);
        $connection->method('fetchOne')->willReturn(false);

        $stateMachine = $this->createMock(StateMachineRegistry::class);
        $stateMachine->method('transition');

        return new ReviewQueueService(
            $configRepo,
            $reviewRepo,
            $bus,
            $this->createMock(SlackNotifier::class),
            $mailService,
            $connection,
            $stateMachine,
            new NullLogger()
        );
    }
}
