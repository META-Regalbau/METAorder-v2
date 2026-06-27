<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Migration;

use Doctrine\DBAL\Connection;
use Shopware\Core\Framework\Migration\MigrationStep;

class Migration202605030002CreateComponentTypeTable extends MigrationStep
{
    public function getCreationTimestamp(): int
    {
        return 202605030002;
    }

    public function update(Connection $connection): void
    {
        $connection->executeStatement(
            <<<'SQL'
            CREATE TABLE IF NOT EXISTS `meta_clip_component_type` (
                `id` BINARY(16) NOT NULL,
                `system_id` BINARY(16) NOT NULL,
                `name` VARCHAR(255) NOT NULL,
                `role` VARCHAR(64) NOT NULL,
                `required` TINYINT(1) NOT NULL DEFAULT 0,
                `sort_order` INT NOT NULL DEFAULT 0,
                `icon` VARCHAR(255) NULL,
                `attribute_schema` JSON NULL,
                `created_at` DATETIME(3) NOT NULL,
                `updated_at` DATETIME(3) NULL,
                PRIMARY KEY (`id`),
                KEY `idx.meta_clip_component_type.system_id` (`system_id`),
                CONSTRAINT `fk.meta_clip_component_type.system_id`
                    FOREIGN KEY (`system_id`) REFERENCES `meta_clip_system` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            SQL
        );
    }

    public function updateDestructive(Connection $connection): void
    {
    }
}
