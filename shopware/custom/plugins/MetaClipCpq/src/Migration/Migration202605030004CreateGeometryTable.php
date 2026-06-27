<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Migration;

use Doctrine\DBAL\Connection;
use Shopware\Core\Framework\Migration\MigrationStep;

class Migration202605030004CreateGeometryTable extends MigrationStep
{
    public function getCreationTimestamp(): int
    {
        return 202605030004;
    }

    public function update(Connection $connection): void
    {
        $connection->executeStatement(
            <<<'SQL'
            CREATE TABLE IF NOT EXISTS `meta_clip_geometry` (
                `id` BINARY(16) NOT NULL,
                `product_mapping_id` BINARY(16) NOT NULL,
                `origin` JSON NULL,
                `anchor_points` JSON NULL,
                `bounding_box` JSON NULL,
                `glb_asset_url` VARCHAR(2048) NULL,
                `lod_levels` JSON NULL,
                `created_at` DATETIME(3) NOT NULL,
                `updated_at` DATETIME(3) NULL,
                PRIMARY KEY (`id`),
                KEY `idx.meta_clip_geometry.product_mapping_id` (`product_mapping_id`),
                CONSTRAINT `fk.meta_clip_geometry.product_mapping_id`
                    FOREIGN KEY (`product_mapping_id`) REFERENCES `meta_clip_product_mapping` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            SQL
        );
    }

    public function updateDestructive(Connection $connection): void
    {
    }
}
