<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Migration;

use Doctrine\DBAL\Connection;
use Shopware\Core\Framework\Migration\MigrationStep;

class Migration202605030003CreateProductMappingTable extends MigrationStep
{
    public function getCreationTimestamp(): int
    {
        return 202605030003;
    }

    public function update(Connection $connection): void
    {
        $connection->executeStatement(
            <<<'SQL'
            CREATE TABLE IF NOT EXISTS `meta_clip_product_mapping` (
                `id` BINARY(16) NOT NULL,
                `shopware_product_id` VARCHAR(64) NOT NULL,
                `shopware_product_number` VARCHAR(128) NOT NULL,
                `system_id` BINARY(16) NOT NULL,
                `component_type_id` BINARY(16) NOT NULL,
                `attributes` JSON NULL,
                `status` VARCHAR(32) NOT NULL,
                `created_at` DATETIME(3) NOT NULL,
                `updated_at` DATETIME(3) NULL,
                PRIMARY KEY (`id`),
                KEY `idx.meta_clip_product_mapping.system_id` (`system_id`),
                KEY `idx.meta_clip_product_mapping.component_type_id` (`component_type_id`),
                KEY `idx.meta_clip_product_mapping.shopware_product_number` (`shopware_product_number`),
                CONSTRAINT `fk.meta_clip_product_mapping.system_id`
                    FOREIGN KEY (`system_id`) REFERENCES `meta_clip_system` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT `fk.meta_clip_product_mapping.component_type_id`
                    FOREIGN KEY (`component_type_id`) REFERENCES `meta_clip_component_type` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            SQL
        );
    }

    public function updateDestructive(Connection $connection): void
    {
    }
}
