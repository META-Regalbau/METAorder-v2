<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Review;

use Doctrine\DBAL\Connection;
use Meta\ClipCpq\Core\Content\Configuration\ConfigurationEntity;
use Meta\ClipCpq\Core\Lobster\Message\DispatchToLobsterMessage;
use Meta\ClipCpq\Core\Notification\SlackNotifier;
use Meta\ClipCpq\Core\Review\Exception\InvalidStatusTransitionException;
use Psr\Log\LoggerInterface;
use Shopware\Core\Checkout\Order\OrderDefinition;
use Shopware\Core\Content\Mail\Service\AbstractMailService;
use Shopware\Core\Framework\Context;
use Shopware\Core\Framework\DataAbstractionLayer\EntityRepository;
use Shopware\Core\Framework\DataAbstractionLayer\Search\Criteria;
use Shopware\Core\Framework\DataAbstractionLayer\Search\Filter\EqualsFilter;
use Shopware\Core\Framework\DataAbstractionLayer\Search\Sorting\FieldSorting;
use Shopware\Core\Framework\Uuid\Uuid;
use Shopware\Core\System\StateMachine\Aggregation\StateMachineTransition\StateMachineTransitionActions;
use Shopware\Core\System\StateMachine\StateMachineRegistry;
use Shopware\Core\System\StateMachine\Transition;
use Symfony\Component\Messenger\MessageBusInterface;

class ReviewQueueService
{
    public const STATUS_NEW = 'new';
    public const STATUS_QUEUED = 'queued_review';
    public const STATUS_ASSIGNED = 'assigned_review';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';
    public const STATUS_CONTACT_REQUESTED = 'contact_requested';
    public const STATUS_LOBSTER_DISPATCHED = 'lobster_dispatched';

    /**
     * @var array<string, list<string>>
     */
    public const ALLOWED_TRANSITIONS = [
        self::STATUS_NEW => [self::STATUS_QUEUED],
        self::STATUS_QUEUED => [self::STATUS_ASSIGNED, self::STATUS_APPROVED, self::STATUS_REJECTED, self::STATUS_CONTACT_REQUESTED],
        self::STATUS_ASSIGNED => [self::STATUS_QUEUED, self::STATUS_APPROVED, self::STATUS_REJECTED, self::STATUS_CONTACT_REQUESTED],
        self::STATUS_CONTACT_REQUESTED => [self::STATUS_ASSIGNED, self::STATUS_APPROVED, self::STATUS_REJECTED],
        self::STATUS_APPROVED => [self::STATUS_LOBSTER_DISPATCHED],
    ];

    /**
     * @param EntityRepository<\Meta\ClipCpq\Core\Content\Configuration\ConfigurationCollection> $configurationRepository
     * @param EntityRepository<\Meta\ClipCpq\Core\Content\ConfigurationReviewLog\ConfigurationReviewLogCollection> $reviewLogRepository
     */
    public function __construct(
        private readonly EntityRepository $configurationRepository,
        private readonly EntityRepository $reviewLogRepository,
        private readonly MessageBusInterface $messageBus,
        private readonly SlackNotifier $slackNotifier,
        private readonly AbstractMailService $mailService,
        private readonly Connection $connection,
        private readonly StateMachineRegistry $stateMachineRegistry,
        private readonly LoggerInterface $logger
    ) {
    }

    public function enqueue(string $configurationId, ?string $actorUserId, Context $context): ConfigurationEntity
    {
        $configuration = $this->loadConfiguration($configurationId, $context);
        $updated = $this->transition($configuration, self::STATUS_QUEUED, 'enqueue', $actorUserId, null, $context);

        try {
            $this->slackNotifier->enqueueForReview($updated, $context);
        } catch (\Throwable $exception) {
            $this->logger->warning('Slack notify failed during enqueue.', [
                'configurationId' => $configurationId,
                'error' => $exception->getMessage(),
            ]);
        }

        $this->sendStatusMail($updated, 'review.received', $context);

        return $updated;
    }

    public function queueForReview(string $configurationId, Context $context): ConfigurationEntity
    {
        return $this->enqueue($configurationId, null, $context);
    }

    public function assign(string $configurationId, string $actorUserId, string $assignedToUserId, Context $context): ConfigurationEntity
    {
        $configuration = $this->loadConfiguration($configurationId, $context);
        $this->assertTransitionAllowed($configuration->getValidationStatus(), self::STATUS_ASSIGNED);

        $this->configurationRepository->update([
            [
                'id' => $configuration->getId(),
                'validationStatus' => self::STATUS_ASSIGNED,
                'assignedTo' => $assignedToUserId,
                'assignedAt' => new \DateTimeImmutable(),
            ],
        ], $context);

        $this->createReviewLog($configuration, self::STATUS_ASSIGNED, 'assign', $actorUserId, ['assignedTo' => $assignedToUserId], $context);

        return $this->loadConfiguration($configurationId, $context);
    }

    public function approve(string $configurationId, ?string $actorUserId, ?string $notes, Context $context): ConfigurationEntity
    {
        $configuration = $this->loadConfiguration($configurationId, $context);
        $updated = $this->transition($configuration, self::STATUS_APPROVED, 'approve', $actorUserId, $notes, $context);

        if ($updated->getOrderId() !== null) {
            $this->messageBus->dispatch(new DispatchToLobsterMessage($updated->getId(), $updated->getOrderId()));
        }

        $this->sendStatusMail($updated, 'review.approved', $context);

        return $updated;
    }

    public function reject(string $configurationId, ?string $actorUserId, ?string $notes, Context $context): ConfigurationEntity
    {
        $configuration = $this->loadConfiguration($configurationId, $context);
        $updated = $this->transition($configuration, self::STATUS_REJECTED, 'reject', $actorUserId, $notes, $context);

        $this->cancelOrder($updated, $context);
        $this->sendStatusMail($updated, 'review.rejected', $context);

        return $updated;
    }

    public function requestCustomerContact(string $configurationId, ?string $actorUserId, ?string $notes, Context $context): ConfigurationEntity
    {
        $configuration = $this->loadConfiguration($configurationId, $context);
        $updated = $this->transition($configuration, self::STATUS_CONTACT_REQUESTED, 'request_customer_contact', $actorUserId, $notes, $context);

        $this->sendStatusMail($updated, 'review.contact_requested', $context);

        return $updated;
    }

    /**
     * @return list<ConfigurationEntity>
     */
    public function listPending(Context $context, int $limit = 50): array
    {
        $criteria = new Criteria();
        $criteria->addFilter(new EqualsFilter('validationStatus', self::STATUS_QUEUED));
        $criteria->addAssociation('reviewLogs');
        $criteria->addAssociation('order');
        $criteria->addSorting(new FieldSorting('createdAt', FieldSorting::DESCENDING));
        $criteria->setLimit($limit);

        /** @var list<ConfigurationEntity> $results */
        $results = $this->configurationRepository->search($criteria, $context)->getElements();

        return $results;
    }

    /**
     * @return list<ConfigurationEntity>
     */
    public function listAssigned(string $userId, Context $context, int $limit = 50): array
    {
        $criteria = new Criteria();
        $criteria->addFilter(new EqualsFilter('validationStatus', self::STATUS_ASSIGNED));
        $criteria->addFilter(new EqualsFilter('assignedTo', $userId));
        $criteria->addAssociation('reviewLogs');
        $criteria->addAssociation('order');
        $criteria->addSorting(new FieldSorting('assignedAt', FieldSorting::DESCENDING));
        $criteria->setLimit($limit);

        /** @var list<ConfigurationEntity> $results */
        $results = $this->configurationRepository->search($criteria, $context)->getElements();

        return $results;
    }

    private function transition(
        ConfigurationEntity $configuration,
        string $toStatus,
        string $action,
        ?string $actorUserId,
        ?string $notes,
        Context $context
    ): ConfigurationEntity {
        $fromStatus = $configuration->getValidationStatus();
        $this->assertTransitionAllowed($fromStatus, $toStatus);

        $payload = [
            'id' => $configuration->getId(),
            'validationStatus' => $toStatus,
            'outcome' => $this->resolveOutcome($toStatus),
            'notes' => $notes,
        ];

        if (in_array($toStatus, [self::STATUS_APPROVED, self::STATUS_REJECTED, self::STATUS_CONTACT_REQUESTED], true)) {
            $payload['completedAt'] = new \DateTimeImmutable();
        }

        $this->configurationRepository->update([$payload], $context);
        $this->createReviewLog($configuration, $toStatus, $action, $actorUserId, ['notes' => $notes], $context);

        return $this->loadConfiguration($configuration->getId(), $context);
    }

    private function assertTransitionAllowed(string $fromStatus, string $toStatus): void
    {
        if (!array_key_exists($fromStatus, self::ALLOWED_TRANSITIONS) && $toStatus === self::STATUS_QUEUED) {
            return;
        }

        $allowed = self::ALLOWED_TRANSITIONS[$fromStatus] ?? [];

        if (!in_array($toStatus, $allowed, true) && $fromStatus !== $toStatus) {
            throw new InvalidStatusTransitionException($fromStatus, $toStatus);
        }
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function createReviewLog(
        ConfigurationEntity $configuration,
        string $toStatus,
        string $action,
        ?string $actorUserId,
        array $payload,
        Context $context
    ): void {
        $this->reviewLogRepository->create([
            [
                'id' => Uuid::randomHex(),
                'configurationId' => $configuration->getId(),
                'actorUserId' => $actorUserId,
                'fromStatus' => $configuration->getValidationStatus(),
                'toStatus' => $toStatus,
                'action' => $action,
                'payload' => $payload,
            ],
        ], $context);
    }

    private function loadConfiguration(string $configurationId, Context $context): ConfigurationEntity
    {
        $criteria = new Criteria([$configurationId]);
        $criteria->addAssociation('customer');
        $criteria->addAssociation('order.orderCustomer');
        $criteria->addAssociation('reviewLogs');

        /** @var ConfigurationEntity|null $configuration */
        $configuration = $this->configurationRepository->search($criteria, $context)->first();
        if ($configuration === null) {
            throw new \RuntimeException(sprintf('Configuration "%s" not found.', $configurationId));
        }

        return $configuration;
    }

    private function resolveOutcome(string $status): ?string
    {
        return match ($status) {
            self::STATUS_APPROVED => 'approved',
            self::STATUS_REJECTED => 'rejected',
            self::STATUS_CONTACT_REQUESTED => 'contact_requested',
            default => null,
        };
    }

    private function cancelOrder(ConfigurationEntity $configuration, Context $context): void
    {
        if ($configuration->getOrderId() === null) {
            return;
        }

        try {
            $this->stateMachineRegistry->transition(new Transition(
                OrderDefinition::ENTITY_NAME,
                $configuration->getOrderId(),
                StateMachineTransitionActions::ACTION_CANCEL,
                'stateId'
            ), $context);
        } catch (\Throwable $exception) {
            $this->logger->warning('Order cancellation failed during review reject.', [
                'configurationId' => $configuration->getId(),
                'orderId' => $configuration->getOrderId(),
                'error' => $exception->getMessage(),
            ]);
        }
    }

    private function sendStatusMail(ConfigurationEntity $configuration, string $statusKey, Context $context): void
    {
        $recipient = $configuration->getCustomer();
        if ($recipient === null || $recipient->getEmail() === null) {
            return;
        }

        $mailTemplateTechnicalName = sprintf('meta_clip_%s', $statusKey);
        $mailTemplateId = $this->connection->fetchOne(
            <<<'SQL'
            SELECT LOWER(HEX(mt.id))
            FROM mail_template mt
            INNER JOIN mail_template_type mtt ON mtt.id = mt.mail_template_type_id
            WHERE mtt.technical_name = :technicalName
            LIMIT 1
            SQL,
            ['technicalName' => $mailTemplateTechnicalName]
        );

        if (!is_string($mailTemplateId)) {
            $this->logger->warning('Mail template for review status is missing.', [
                'configurationId' => $configuration->getId(),
                'statusKey' => $statusKey,
            ]);

            return;
        }

        $this->mailService->send([
            'recipients' => [$recipient->getEmail() => trim($recipient->getFirstName() . ' ' . $recipient->getLastName())],
            'salesChannelId' => $configuration->getSalesChannelId(),
            'mailTemplateId' => $mailTemplateId,
        ], $context, [
            'customer' => $recipient,
            'configuration' => $configuration,
            'order' => $configuration->getOrder(),
        ]);
    }
}
