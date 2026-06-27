<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Migration;

use Doctrine\DBAL\Connection;
use Shopware\Core\Framework\Migration\MigrationStep;

class Migration202605030005CreateRuleTable extends MigrationStep
{
    public function getCreationTimestamp(): int
    {
        return 202605030005;
    }

    public function update(Connection $connection): void
    {
        $connection->executeStatement(
            <<<'SQL'
            CREATE TABLE IF NOT EXISTS `meta_clip_rule` (
                `id` BINARY(16) NOT NULL,
                `system_id` BINARY(16) NOT NULL,
                `name` VARCHAR(255) NOT NULL,
                `type` VARCHAR(32) NOT NULL,
                `priority` INT NOT NULL DEFAULT 100,
                `condition` JSON NOT NULL,
                `action` JSON NOT NULL,
                `fallback` JSON NULL,
                `message` VARCHAR(1024) NULL,
                `status` VARCHAR(32) NOT NULL,
                `version` INT NOT NULL DEFAULT 1,
                `created_by` VARCHAR(255) NULL,
                `technical_key` VARCHAR(255) NULL,
                `created_at` DATETIME(3) NOT NULL,
                `updated_at` DATETIME(3) NULL,
                PRIMARY KEY (`id`),
                UNIQUE KEY `uniq.meta_clip_rule.system_key` (`system_id`, `technical_key`),
                KEY `idx.meta_clip_rule.system_id` (`system_id`),
                KEY `idx.meta_clip_rule.type_status` (`type`, `status`),
                CONSTRAINT `fk.meta_clip_rule.system_id`
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
