<?php

declare(strict_types=1);

namespace Meta\CartSignal\Tests\Unit;

use Meta\CartSignal\Core\CartSignalPayload;
use Meta\CartSignal\Core\CartSignalSettings;
use PHPUnit\Framework\TestCase;

class CartSignalPayloadTest extends TestCase
{
    private const CUSTOMER = ['id' => 'c1', 'customerNumber' => ' 20001 ', 'company' => 'Muster GmbH', 'firstName' => 'Erika', 'lastName' => 'Muster', 'email' => 'erika@example.org', 'phone' => ''];

    public function testBusinessCustomerByCompanyOrFlag(): void
    {
        static::assertTrue(CartSignalPayload::isBusinessCustomer('Muster GmbH', null, [], 'wdu_b2b_dealer'));
        static::assertTrue(CartSignalPayload::isBusinessCustomer('', 'Muster GmbH', [], 'wdu_b2b_dealer'));
        static::assertTrue(CartSignalPayload::isBusinessCustomer(null, null, ['wdu_b2b_dealer' => true], 'wdu_b2b_dealer'));
        static::assertFalse(CartSignalPayload::isBusinessCustomer(null, ' ', ['wdu_b2b_dealer' => false], 'wdu_b2b_dealer'));
    }

    public function testCartSavedContainsOnlyFiguresAndContact(): void
    {
        $positions = [];
        for ($i = 1; $i <= 60; ++$i) {
            $positions[] = ['productNumber' => 'SW' . $i, 'label' => 'Artikel ' . $i, 'quantity' => 1, 'netTotal' => 10.004];
        }
        $p = CartSignalPayload::cartSaved(self::CUSTOMER, $positions, 'EUR', 'sc1', new \DateTimeImmutable('2026-10-18T10:00:00+02:00'));
        static::assertSame('cart.saved', $p['event']);
        static::assertSame('2026-10-18T10:00:00+02:00', $p['occurredAt']);
        static::assertSame(['id' => 'c1', 'customerNumber' => '20001', 'company' => 'Muster GmbH', 'contactName' => 'Erika Muster', 'email' => 'erika@example.org', 'phone' => null], $p['customer']);
        static::assertSame(600.24, $p['cart']['netTotal']);
        static::assertSame(60, $p['cart']['positionCount']);
        static::assertCount(CartSignalPayload::MAX_POSITIONS, $p['cart']['positions']);
        static::assertSame(['productNumber' => 'SW1', 'label' => 'Artikel 1', 'quantity' => 1, 'netTotal' => 10.0], $p['cart']['positions'][0]);
        static::assertStringNotContainsString('token', CartSignalPayload::encode($p));
    }

    public function testOrderPlaced(): void
    {
        $p = CartSignalPayload::orderPlaced(self::CUSTOMER, 'MO10001', 'sc1', new \DateTimeImmutable('2026-10-18T10:00:00Z'));
        static::assertSame('order.placed', $p['event']);
        static::assertSame(['orderNumber' => 'MO10001'], $p['order']);
    }

    public function testSettingsNeedHttpsTenantAndSecret(): void
    {
        $base = ['active' => true, 'endpointUrl' => 'https://metaorder.example/', 'tenantId' => 't1', 'secret' => 's'];
        $s = CartSignalSettings::fromArray($base);
        static::assertTrue($s->isUsable());
        static::assertSame('https://metaorder.example', $s->endpointUrl);
        static::assertSame(500.0, $s->minNetTotal);
        static::assertSame(3.0, $s->timeoutSeconds);
        static::assertSame(CartSignalSettings::DELIVERY_QUEUE, $s->delivery);
        static::assertSame('wdu_b2b_dealer', $s->b2bFlagField);
        static::assertFalse(CartSignalSettings::fromArray(['active' => false] + $base)->isUsable());
        static::assertFalse(CartSignalSettings::fromArray(['endpointUrl' => 'http://metaorder.example'] + $base)->isUsable());
        static::assertTrue(CartSignalSettings::fromArray(['endpointUrl' => 'http://localhost:5055'] + $base)->isUsable());
        static::assertFalse(CartSignalSettings::fromArray(['secret' => ''] + $base)->isUsable());
        static::assertSame(10.0, CartSignalSettings::fromArray(['timeoutSeconds' => 99] + $base)->timeoutSeconds);
    }
}
