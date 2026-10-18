<?php

declare(strict_types=1);

namespace Meta\CartSignal\Core;

/**
 * Inhalt der Meldung an METAorder, ohne Shopware-Klassen (Tests in tests/Unit). Gesendet werden nur
 * Kennzahlen und der Ansprechpartner: Kundennummer, Firma, Name, E-Mail, Telefon; je Position Artikelnummer,
 * Bezeichnung, Menge und Netto-Summe; Netto-Wert und Zeitpunkt. Keine Adressen, keine Zahlungsdaten, kein
 * Warenkorb-Token.
 *
 * Ereignisse:
 * - cart.saved: Warenkorb eines angemeldeten Geschäftskunden gespeichert
 * - order.placed: derselbe Kunde hat bestellt (METAorder legt dann keinen Alarm mehr an)
 */
final class CartSignalPayload
{
    public const VERSION = 1;
    public const MAX_POSITIONS = 50;

    /**
     * Geschäftskunde: Firma gesetzt (Kunde oder Rechnungsadresse) oder B2B-Kennzeichen im Zusatzfeld
     *
     * @param array<string, mixed> $customFields
     */
    public static function isBusinessCustomer(?string $company, ?string $billingCompany, array $customFields, string $flagField): bool
    {
        if (trim((string) $company) !== '' || trim((string) $billingCompany) !== '') {
            return true;
        }
        $flag = $customFields[$flagField] ?? null;

        return $flag === true || $flag === 1 || $flag === '1';
    }

    /**
     * @param array{id: string, customerNumber: string, company: string, firstName: string, lastName: string, email: string, phone: ?string} $customer
     * @param list<array{productNumber: string, label: string, quantity: int, netTotal: float}> $positions
     *
     * @return array<string, mixed>
     */
    public static function cartSaved(array $customer, array $positions, string $currency, string $salesChannelId, \DateTimeInterface $at): array
    {
        $listed = \array_slice($positions, 0, self::MAX_POSITIONS);
        $net = 0.0;
        foreach ($positions as $p) {
            $net += $p['netTotal'];
        }

        return [
            'version' => self::VERSION,
            'event' => 'cart.saved',
            'occurredAt' => $at->format(\DateTimeInterface::ATOM),
            'salesChannelId' => $salesChannelId,
            'customer' => self::customer($customer),
            'cart' => [
                'netTotal' => round($net, 2),
                'currency' => $currency,
                'positionCount' => \count($positions),
                'positions' => array_map(static fn (array $p): array => [
                    'productNumber' => mb_substr($p['productNumber'], 0, 64),
                    'label' => mb_substr($p['label'], 0, 200),
                    'quantity' => $p['quantity'],
                    'netTotal' => round($p['netTotal'], 2),
                ], $listed),
            ],
        ];
    }

    /**
     * @param array{id: string, customerNumber: string, company: string, firstName: string, lastName: string, email: string, phone: ?string} $customer
     *
     * @return array<string, mixed>
     */
    public static function orderPlaced(array $customer, string $orderNumber, string $salesChannelId, \DateTimeInterface $at): array
    {
        return [
            'version' => self::VERSION,
            'event' => 'order.placed',
            'occurredAt' => $at->format(\DateTimeInterface::ATOM),
            'salesChannelId' => $salesChannelId,
            'customer' => self::customer($customer),
            'order' => ['orderNumber' => mb_substr($orderNumber, 0, 64)],
        ];
    }

    /**
     * @param array<string, mixed> $payload
     */
    public static function encode(array $payload): string
    {
        return json_encode($payload, \JSON_UNESCAPED_UNICODE | \JSON_UNESCAPED_SLASHES | \JSON_PRESERVE_ZERO_FRACTION | \JSON_THROW_ON_ERROR);
    }

    /**
     * @param array{id: string, customerNumber: string, company: string, firstName: string, lastName: string, email: string, phone: ?string} $c
     *
     * @return array<string, string|null>
     */
    private static function customer(array $c): array
    {
        $phone = trim((string) ($c['phone'] ?? ''));

        return [
            'id' => $c['id'],
            'customerNumber' => mb_substr(trim($c['customerNumber']), 0, 64),
            'company' => mb_substr(trim($c['company']), 0, 200),
            'contactName' => mb_substr(trim($c['firstName'] . ' ' . $c['lastName']), 0, 200),
            'email' => mb_substr(trim($c['email']), 0, 200),
            'phone' => $phone !== '' ? mb_substr($phone, 0, 60) : null,
        ];
    }
}
