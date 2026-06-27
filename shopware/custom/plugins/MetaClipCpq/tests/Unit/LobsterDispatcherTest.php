<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Tests\Unit;

use Meta\ClipCpq\Core\Content\Configuration\ConfigurationEntity;
use Meta\ClipCpq\Core\Lobster\LobsterDispatcher;
use Meta\ClipCpq\Core\Lobster\OrderPositionMapper;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Shopware\Core\Checkout\Order\OrderEntity;
use Shopware\Core\System\SystemConfig\SystemConfigService;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Symfony\Contracts\HttpClient\ResponseInterface;

class LobsterDispatcherTest extends TestCase
{
    public function testDispatchSendsPayloadToConfiguredWebhook(): void
    {
        $response = $this->createMock(ResponseInterface::class);
        $response->method('getStatusCode')->willReturn(200);
        $response->method('toArray')->with(false)->willReturn(['ok' => true]);

        $httpClient = $this->createMock(HttpClientInterface::class);
        $httpClient->expects(static::once())
            ->method('request')
            ->with('POST', 'https://example.org/hook')
            ->willReturn($response);

        $config = $this->createMock(SystemConfigService::class);
        $config->method('get')->willReturnMap([
            ['MetaClipCpq.config.lobsterWebhookUrl', null, 'https://example.org/hook'],
            ['MetaClipCpq.config.lobsterApiKey', null, 'apikey'],
            ['MetaClipCpq.config.lobsterTimeoutSeconds', null, 5],
            ['MetaClipCpq.config.lobsterRetryAttempts', null, 1],
        ]);

        $dispatcher = new LobsterDispatcher($httpClient, new OrderPositionMapper(), $config, new NullLogger());

        $order = new OrderEntity();
        $order->assign(['id' => 'order-id', 'orderNumber' => '10010', 'amountTotal' => 120.0, 'currencyId' => 'currency-id']);
        $configuration = new ConfigurationEntity();
        $configuration->assign(['id' => 'cfg-id', 'name' => 'Config', 'validationStatus' => 'approved', 'configData' => []]);

        $result = $dispatcher->dispatch($order, $configuration);

        static::assertSame(['ok' => true], $result);
    }
}
