<?php

declare(strict_types=1);

namespace Meta\CartSignal\Tests\Unit;

use Meta\CartSignal\Core\CartSignalSender;
use Meta\CartSignal\Core\CartSignalSettings;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Symfony\Component\HttpClient\Exception\TransportException;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

class CartSignalSenderTest extends TestCase
{
    private function settings(array $over = []): CartSignalSettings
    {
        return CartSignalSettings::fromArray($over + ['active' => true, 'endpointUrl' => 'https://metaorder.example', 'tenantId' => 't1', 'secret' => 'secret', 'timeoutSeconds' => 2]);
    }

    public function testPostsSignedBodyWithTimeout(): void
    {
        $seen = [];
        $client = new MockHttpClient(static function (string $method, string $url, array $options) use (&$seen): MockResponse {
            $seen = ['method' => $method, 'url' => $url, 'options' => $options];

            return new MockResponse('{"ok":true}', ['http_code' => 202]);
        });
        static::assertTrue((new CartSignalSender($client, new NullLogger()))->send($this->settings(), '{"a":1}', 1700000000));
        static::assertSame('POST', $seen['method']);
        static::assertSame('https://metaorder.example/api/public/shop-pulse/cart-signal', $seen['url']);
        static::assertSame('{"a":1}', $seen['options']['body']);
        static::assertSame(2.0, $seen['options']['timeout']);
        static::assertContains('X-Meta-Signature: sha256=' . hash_hmac('sha256', '1700000000.{"a":1}', 'secret'), $seen['options']['headers']);
    }

    public function testErrorsAreSwallowed(): void
    {
        $failing = new MockHttpClient(static fn (): MockResponse => throw new TransportException('timeout'));
        static::assertFalse((new CartSignalSender($failing, new NullLogger()))->send($this->settings(), '{}'));
        $rejected = new MockHttpClient(new MockResponse('', ['http_code' => 401]));
        static::assertFalse((new CartSignalSender($rejected, new NullLogger()))->send($this->settings(), '{}'));
    }

    public function testNothingSentWhenNotConfigured(): void
    {
        $client = new MockHttpClient(static fn (): MockResponse => throw new \LogicException('darf nicht senden'));
        static::assertFalse((new CartSignalSender($client, new NullLogger()))->send($this->settings(['secret' => '']), '{}'));
    }
}
