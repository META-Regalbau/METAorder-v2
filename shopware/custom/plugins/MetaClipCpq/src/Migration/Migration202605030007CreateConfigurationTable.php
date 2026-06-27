<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Migration;

use Doctrine\DBAL\Connection;
use Shopware\Core\Framework\Migration\MigrationStep;

class Migration202605030007CreateConfigurationTable extends MigrationStep
{
    public function getCreationTimestamp(): int
    {
        return 202605030007;
    }

    public function update(Connection $connection): void
    {
        $connection->executeStatement(
            <<<'SQL'
            CREATE TABLE IF NOT EXISTS `meta_clip_configuration` (
                `id` BINARY(16) NOT NULL,
                `system_id` BINARY(16) NOT NULL,
                `customer_id` BINARY(16) NULL,
                `order_id` BINARY(16) NULL,
                `sales_channel_id` BINARY(16) NULL,
                `name` VARCHAR(255) NOT NULL,
                `config_data` JSON NOT NULL,
                `validation_status` VARCHAR(32) NOT NULL,
                `total_price` DOUBLE NOT NULL DEFAULT 0,
                `created_at` DATETIME(3) NOT NULL,
                `updated_at` DATETIME(3) NULL,
                PRIMARY KEY (`id`),
                KEY `idx.meta_clip_configuration.system_id` (`system_id`),
                KEY `idx.meta_clip_configuration.customer_id` (`customer_id`),
                KEY `idx.meta_clip_configuration.order_id` (`order_id`),
                KEY `idx.meta_clip_configuration.sales_channel_id` (`sales_channel_id`),
                CONSTRAINT `fk.meta_clip_configuration.system_id`
                    FOREIGN KEY (`system_id`) REFERENCES `meta_clip_system` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT `fk.meta_clip_configuration.customer_id`
                    FOREIGN KEY (`customer_id`) REFERENCES `customer` (`id`)
                    ON DELETE SET NULL ON UPDATE CASCADE,
                CONSTRAINT `fk.meta_clip_configuration.order_id`
                    FOREIGN KEY (`order_id`) REFERENCES `order` (`id`)
                    ON DELETE SET NULL ON UPDATE CASCADE,
                CONSTRAINT `fk.meta_clip_configuration.sales_channel_id`
                    FOREIGN KEY (`sales_channel_id`) REFERENCES `sales_channel` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            SQL
        );
    }

    public function updateDestructive(Connection $connection): void
    {
    }
}
