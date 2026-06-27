<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Tests\Unit;

use Meta\ClipCpq\Core\Lobster\OrderPositionMapper;
use PHPUnit\Framework\TestCase;
use Shopware\Core\Checkout\Order\Aggregate\OrderLineItem\OrderLineItemCollection;
use Shopware\Core\Checkout\Order\Aggregate\OrderLineItem\OrderLineItemEntity;
use Shopware\Core\Checkout\Order\OrderEntity;

class OrderPositionMapperTest extends TestCase
{
    public function testBuildPayloadMapsOrderAndLineItems(): void
    {
        $lineItem = new OrderLineItemEntity();
        $lineItem->assign([
            'id' => 'line-item-id',
            'identifier' => 'sku-1',
            'label' => 'Test Item',
            'type' => 'product',
            'quantity' => 2,
            'totalPrice' => 199.99,
            'payload' => ['meta' => 'value'],
        ]);

        $order = new OrderEntity();
        $order->assign([
            'id' => 'order-id',
            'orderNumber' => '10001',
            'currencyId' => 'currency-id',
            'amountTotal' => 199.99,
            'lineItems' => new OrderLineItemCollection([$lineItem]),
        ]);

        $payload = (new OrderPositionMapper())->buildPayload($order, ['id' => 'cfg']);

        static::assertSame('10001', $payload['orderId']);
        static::assertSame('order-id', $payload['shopwareOrderId']);
        static::assertCount(1, $payload['positions']);
        static::assertSame('sku-1', $payload['positions'][0]['identifier']);
    }
}
