<?php

declare(strict_types=1);

namespace Meta\CartSignal\Core;

/**
 * Signatur der Meldung an METAorder: HMAC-SHA256 über „<Zeitstempel>.<Body>“ mit dem geheimen Schlüssel aus
 * METAorder (Shop-Puls → Warenkorb-Alarm). METAorder prüft sie in server/shopPulse/cartSignal.ts und
 * verwirft Meldungen, deren Zeitstempel mehr als 5 Minuten abweicht.
 */
final class CartSignalSigner
{
    public static function sign(string $secret, int $timestamp, string $body): string
    {
        return hash_hmac('sha256', $timestamp . '.' . $body, $secret);
    }

    /**
     * @return array<string, string>
     */
    public static function headers(string $tenantId, string $secret, int $timestamp, string $body): array
    {
        return [
            'Content-Type' => 'application/json',
            'X-Meta-Tenant' => $tenantId,
            'X-Meta-Timestamp' => (string) $timestamp,
            'X-Meta-Signature' => 'sha256=' . self::sign($secret, $timestamp, $body),
        ];
    }
}
