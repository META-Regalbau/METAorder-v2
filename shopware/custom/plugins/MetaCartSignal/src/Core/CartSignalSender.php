<?php

declare(strict_types=1);

namespace Meta\CartSignal\Core;

use Psr\Log\LoggerInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * Schickt eine Meldung signiert an METAorder (POST <Adresse>/api/public/shop-pulse/cart-signal). Kurzer Timeout,
 * kein Wiederholen, jeder Fehler wird nur protokolliert: Der Kauf darf nie davon abhängen.
 */
class CartSignalSender
{
    public const PATH = '/api/public/shop-pulse/cart-signal';

    public function __construct(
        private readonly HttpClientInterface $httpClient,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function send(CartSignalSettings $settings, string $body, ?int $timestamp = null): bool
    {
        if (!$settings->isUsable()) {
            return false;
        }
        $ts = $timestamp ?? time();
        try {
            $response = $this->httpClient->request('POST', $settings->endpointUrl . self::PATH, [
                'headers' => CartSignalSigner::headers($settings->tenantId, $settings->secret, $ts, $body),
                'body' => $body,
                'timeout' => $settings->timeoutSeconds,
                'max_duration' => $settings->timeoutSeconds,
                'max_redirects' => 0,
            ]);
            $status = $response->getStatusCode();
            if ($status >= 200 && $status < 300) {
                return true;
            }
            $this->logger->warning('META Warenkorb-Signal: METAorder hat abgelehnt', ['status' => $status]);
        } catch (\Throwable $e) {
            $this->logger->warning('META Warenkorb-Signal: nicht gesendet', ['error' => mb_substr($e->getMessage(), 0, 300)]);
        }

        return false;
    }
}
