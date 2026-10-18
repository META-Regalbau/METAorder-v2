<?php

declare(strict_types=1);

namespace Meta\CartSignal\Tests\Unit;

use Meta\CartSignal\Core\CartSignalSigner;
use PHPUnit\Framework\TestCase;

class CartSignalSignerTest extends TestCase
{
    public function testSignatureMatchesSharedFixture(): void
    {
        // dieselbe Vorlage prüft METAorder in tests/unit/shopPulseCartSignal.test.ts
        $f = json_decode((string) file_get_contents(__DIR__ . '/../Fixtures/signature.json'), true, 512, \JSON_THROW_ON_ERROR);
        static::assertSame($f['signature'], CartSignalSigner::sign($f['secret'], $f['timestamp'], $f['body']));
    }

    public function testHeadersCarryTenantTimestampAndSignature(): void
    {
        $headers = CartSignalSigner::headers('t1', 'secret', 1700000000, '{}');
        static::assertSame('t1', $headers['X-Meta-Tenant']);
        static::assertSame('1700000000', $headers['X-Meta-Timestamp']);
        static::assertSame('sha256=' . hash_hmac('sha256', '1700000000.{}', 'secret'), $headers['X-Meta-Signature']);
    }
}
