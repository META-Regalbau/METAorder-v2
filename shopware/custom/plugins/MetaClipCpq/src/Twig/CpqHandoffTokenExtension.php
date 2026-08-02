<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Twig;

use Shopware\Core\System\SystemConfig\SystemConfigService;
use Twig\Extension\AbstractExtension;
use Twig\TwigFunction;

/**
 * Signiert den CPQ-Handoff-Token für den "Regal konfigurieren"-Link auf der
 * Produktseite (siehe product-detail/index.html.twig). Der Kunde landet damit
 * ohne eigenen METAorder-Login im Konfigurator — METAorder verifiziert dort
 * nur die Signatur (server/cpqHandoffToken.ts implementiert exakt dasselbe
 * Format unabhängig, bewusst kein echtes JWT/keine Composer-Abhängigkeit).
 *
 * Format: base64url(json_encode(payload)) . "." . base64url(hash_hmac('sha256', payloadB64, secret, true))
 */
class CpqHandoffTokenExtension extends AbstractExtension
{
    private const DEFAULT_TTL_MINUTES = 30;

    public function __construct(private readonly SystemConfigService $systemConfigService)
    {
    }

    public function getFunctions(): array
    {
        return [
            new TwigFunction('meta_clip_cpq_handoff_token', [$this, 'createToken']),
            new TwigFunction('meta_clip_cpq_configurator_url', [$this, 'buildConfiguratorUrl']),
        ];
    }

    /** Leerer String = Plugin auf dieser Sales-Channel-Ebene nicht konfiguriert (Link wird dann ausgeblendet). */
    public function createToken(?string $customerId, ?string $salesChannelId, ?string $productId): string
    {
        $tenantId = trim((string) ($this->systemConfigService->get('MetaClipCpq.config.cpqTenantId', $salesChannelId) ?? ''));
        $secret = trim((string) ($this->systemConfigService->get('MetaClipCpq.config.cpqHandoffSecret', $salesChannelId) ?? ''));

        if ($tenantId === '' || $secret === '') {
            return '';
        }

        $payload = [
            'tenantId' => $tenantId,
            'customerId' => $customerId,
            'salesChannelId' => $salesChannelId,
            'productId' => $productId,
            'exp' => time() + self::DEFAULT_TTL_MINUTES * 60,
        ];

        $payloadB64 = self::base64UrlEncode(json_encode($payload, \JSON_THROW_ON_ERROR));
        $signature = self::base64UrlEncode(hash_hmac('sha256', $payloadB64, $secret, true));

        return $payloadB64 . '.' . $signature;
    }

    public function buildConfiguratorUrl(string $token, ?string $salesChannelId): ?string
    {
        if ($token === '') {
            return null;
        }
        $baseUrl = rtrim((string) ($this->systemConfigService->get('MetaClipCpq.config.metaorderBaseUrl', $salesChannelId) ?? ''), '/');
        if ($baseUrl === '') {
            return null;
        }

        return $baseUrl . '/konfigurator/' . rawurlencode($token);
    }

    private static function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}
