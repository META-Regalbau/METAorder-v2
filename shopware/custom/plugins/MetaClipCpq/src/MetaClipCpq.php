<?php

declare(strict_types=1);

namespace Meta\ClipCpq;

use Doctrine\DBAL\Connection;
use Shopware\Core\Framework\Plugin;
use Shopware\Core\Framework\Plugin\Context\UninstallContext;

class MetaClipCpq extends Plugin
{
    /**
     * @var list<string>
     */
    private const META_CLIP_TABLES = [
        'meta_clip_rule_version',
        'meta_clip_rule',
        'meta_clip_geometry',
        'meta_clip_product_mapping',
        'meta_clip_component_type',
        'meta_clip_configuration_review_log',
        'meta_clip_configuration',
        'meta_clip_system',
    ];

    public function uninstall(UninstallContext $uninstallContext): void
    {
        parent::uninstall($uninstallContext);

        if ($uninstallContext->keepUserData()) {
            return;
        }

        /** @var Connection $connection */
        $connection = $this->container->get(Connection::class);

        foreach (self::META_CLIP_TABLES as $tableName) {
            $connection->executeStatement(sprintf('DROP TABLE IF EXISTS `%s`', $tableName));
        }
    }
}
