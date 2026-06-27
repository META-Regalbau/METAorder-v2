<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Notification;

use Meta\ClipCpq\Core\Content\Configuration\ConfigurationEntity;
use Psr\Log\LoggerInterface;
use Shopware\Core\Framework\Context;
use Shopware\Core\Framework\DataAbstractionLayer\EntityRepository;
use Shopware\Core\Framework\DataAbstractionLayer\Search\Criteria;
use Shopware\Core\Framework\DataAbstractionLayer\Search\Filter\EqualsFilter;
use Shopware\Core\Framework\Uuid\Uuid;
use Shopware\Core\System\SystemConfig\SystemConfigService;
use Symfony\Contracts\HttpClient\HttpClientInterface;

class SlackNotifier
{
    private const CONFIG_PREFIX = 'MetaClipCpq.config.';

    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly EntityRepository $reviewLogRepository,
        private readonly SystemConfigService $systemConfigService,
        private readonly LoggerInterface $logger
    ) {
    }

    public function enqueueForReview(ConfigurationEntity $configuration, Context $context): void
    {
        if ($this->alreadyNotified($configuration->getId(), $context)) {
            return;
        }

        $webhookUrl = trim((string) $this->systemConfigService->get(self::CONFIG_PREFIX . 'slackWebhookUrl'));
        if ($webhookUrl === '') {
            return;
        }

        $payload = [
            'text' => sprintf(
                'META CLIP Review Queue: Konfiguration "%s" (%s) wartet auf Freigabe.',
                $configuration->getName(),
                $configuration->getId()
            ),
        ];

        $this->httpClient->request('POST', $webhookUrl, [
            'headers' => ['Content-Type' => 'application/json'],
            'json' => $payload,
        ])->getStatusCode();

        $this->reviewLogRepository->create([
            [
                'id' => Uuid::randomHex(),
                'configurationId' => $configuration->getId(),
                'fromStatus' => $configuration->getValidationStatus(),
                'toStatus' => $configuration->getValidationStatus(),
                'action' => 'slack_notified',
                'payload' => ['channel' => 'webhook'],
            ],
        ], $context);

        $this->logger->info('Slack notification sent for review queue.', [
            'configurationId' => $configuration->getId(),
        ]);
    }

    private function alreadyNotified(string $configurationId, Context $context): bool
    {
        $criteria = new Criteria();
        $criteria->addFilter(new EqualsFilter('configurationId', $configurationId));
        $criteria->addFilter(new EqualsFilter('action', 'slack_notified'));
        $criteria->setLimit(1);

        return $this->reviewLogRepository->searchIds($criteria, $context)->getTotal() > 0;
    }
}
