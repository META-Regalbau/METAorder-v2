<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Lobster;

use Meta\ClipCpq\Core\Content\Configuration\ConfigurationEntity;
use Psr\Log\LoggerInterface;
use Shopware\Core\Checkout\Order\OrderEntity;
use Shopware\Core\System\SystemConfig\SystemConfigService;
use Symfony\Contracts\HttpClient\Exception\TransportExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

class LobsterDispatcher
{
    public const CONFIG_PREFIX = 'MetaClipCpq.config.';

    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly OrderPositionMapper $orderPositionMapper,
        private readonly SystemConfigService $systemConfigService,
        private readonly LoggerInterface $logger
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function dispatch(OrderEntity $order, ConfigurationEntity $configuration): array
    {
        $url = trim((string) $this->systemConfigService->get(self::CONFIG_PREFIX . 'lobsterWebhookUrl'));
        $apiKey = trim((string) $this->systemConfigService->get(self::CONFIG_PREFIX . 'lobsterApiKey'));
        $timeout = (int) ($this->systemConfigService->get(self::CONFIG_PREFIX . 'lobsterTimeoutSeconds') ?? 10);
        $attempts = max(1, (int) ($this->systemConfigService->get(self::CONFIG_PREFIX . 'lobsterRetryAttempts') ?? 3));

        if ($url === '') {
            throw new \RuntimeException('Lobster webhook URL is not configured.');
        }

        $payload = $this->orderPositionMapper->buildPayload($order, [
            'id' => $configuration->getId(),
            'name' => $configuration->getName(),
            'validationStatus' => $configuration->getValidationStatus(),
            'configData' => $configuration->getConfigData(),
        ]);

        $lastException = null;

        for ($attempt = 1; $attempt <= $attempts; ++$attempt) {
            try {
                $response = $this->httpClient->request('POST', $url, [
                    'headers' => [
                        'Content-Type' => 'application/json',
                        'X-Meta-Clip-Api-Key' => $apiKey,
                    ],
                    'timeout' => $timeout,
                    'json' => $payload,
                ]);

                $statusCode = $response->getStatusCode();
                if ($statusCode >= 400) {
                    throw new \RuntimeException(sprintf('Lobster webhook responded with status %d.', $statusCode));
                }

                $body = $response->toArray(false);
                $this->logger->info('MetaClip configuration dispatched to Lobster.', [
                    'configurationId' => $configuration->getId(),
                    'orderId' => $order->getId(),
                    'attempt' => $attempt,
                ]);

                return is_array($body) ? $body : ['status' => 'ok'];
            } catch (TransportExceptionInterface|\Throwable $exception) {
                $lastException = $exception;

                $this->logger->warning('Lobster dispatch attempt failed.', [
                    'configurationId' => $configuration->getId(),
                    'orderId' => $order->getId(),
                    'attempt' => $attempt,
                    'error' => $exception->getMessage(),
                ]);
            }
        }

        throw new \RuntimeException(
            sprintf('Lobster dispatch failed after %d attempts.', $attempts),
            0,
            $lastException
        );
    }
}
