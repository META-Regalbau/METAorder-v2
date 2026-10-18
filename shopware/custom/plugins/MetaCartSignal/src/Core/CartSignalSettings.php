<?php

declare(strict_types=1);

namespace Meta\CartSignal\Core;

/**
 * Plugin-Konfiguration (Einstellungen → Erweiterungen → META Warenkorb-Signal) als Wertobjekt. Fehlt
 * Adresse, Mandant oder Schlüssel, ist das Plugin aus und sendet nichts.
 */
final class CartSignalSettings
{
    public const DELIVERY_QUEUE = 'queue';
    public const DELIVERY_TERMINATE = 'terminate';

    public function __construct(
        public readonly bool $active,
        public readonly string $endpointUrl,
        public readonly string $tenantId,
        public readonly string $secret,
        public readonly float $minNetTotal,
        public readonly float $timeoutSeconds,
        public readonly string $delivery,
        public readonly string $b2bFlagField,
    ) {
    }

    /**
     * @param array<string, mixed> $config Werte aus dem SystemConfigService (Schlüssel ohne Präfix)
     */
    public static function fromArray(array $config): self
    {
        $text = static fn (string $key): string => \is_scalar($config[$key] ?? null) ? trim((string) $config[$key]) : '';
        $number = static fn (string $key, float $default): float => is_numeric($config[$key] ?? null) ? (float) $config[$key] : $default;
        $timeout = $number('timeoutSeconds', 3.0);
        $delivery = $text('delivery') === self::DELIVERY_TERMINATE ? self::DELIVERY_TERMINATE : self::DELIVERY_QUEUE;

        return new self(
            ($config['active'] ?? false) === true || ($config['active'] ?? null) === '1' || ($config['active'] ?? null) === 1,
            rtrim($text('endpointUrl'), '/'),
            $text('tenantId'),
            $text('secret'),
            max(0.0, $number('minNetTotal', 500.0)),
            min(10.0, max(0.5, $timeout)),
            $delivery,
            $text('b2bFlagField') !== '' ? $text('b2bFlagField') : 'wdu_b2b_dealer',
        );
    }

    /** Eingeschaltet und vollständig: https-Adresse (http nur für localhost), Mandant und Schlüssel */
    public function isUsable(): bool
    {
        if (!$this->active || $this->tenantId === '' || $this->secret === '') {
            return false;
        }
        $scheme = strtolower((string) parse_url($this->endpointUrl, \PHP_URL_SCHEME));
        $host = strtolower((string) parse_url($this->endpointUrl, \PHP_URL_HOST));

        return $scheme === 'https' || ($scheme === 'http' && \in_array($host, ['localhost', '127.0.0.1', 'host.docker.internal'], true));
    }
}
