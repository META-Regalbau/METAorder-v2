<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Lobster;

use Shopware\Core\Checkout\Order\OrderEntity;
use Shopware\Core\Checkout\Order\Aggregate\OrderLineItem\OrderLineItemCollection;
use Shopware\Core\Checkout\Order\Aggregate\OrderLineItem\OrderLineItemEntity;

class OrderPositionMapper
{
    /**
     * @return array<string, mixed>
     */
    public function buildPayload(OrderEntity $order, array $configurationData): array
    {
        return [
            'orderId' => $order->getOrderNumber() ?? $order->getId(),
            'shopwareOrderId' => $order->getId(),
            'currencyId' => $order->getCurrencyId(),
            'priceTotal' => $order->getAmountTotal(),
            'configuration' => $configurationData,
            'positions' => $this->mapLineItems($order->getLineItems()),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function mapLineItems(?OrderLineItemCollection $lineItems): array
    {
        if ($lineItems === null) {
            return [];
        }

        return array_map(
            fn (OrderLineItemEntity $lineItem): array => [
                'id' => $lineItem->getId(),
                'type' => $lineItem->getType(),
                'label' => $lineItem->getLabel(),
                'identifier' => $lineItem->getIdentifier(),
                'quantity' => $lineItem->getQuantity(),
                'price' => $lineItem->getTotalPrice(),
                'payload' => $lineItem->getPayload() ?? [],
            ],
            $lineItems->getElements()
        );
    }
}
