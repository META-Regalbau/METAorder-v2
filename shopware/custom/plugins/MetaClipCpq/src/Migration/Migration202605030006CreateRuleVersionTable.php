<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Migration;

use Doctrine\DBAL\Connection;
use Shopware\Core\Framework\Migration\MigrationStep;

class Migration202605030006CreateRuleVersionTable extends MigrationStep
{
    public function getCreationTimestamp(): int
    {
        return 202605030006;
    }

    public function update(Connection $connection): void
    {
        $connection->executeStatement(
            <<<'SQL'
            CREATE TABLE IF NOT EXISTS `meta_clip_rule_version` (
                `id` BINARY(16) NOT NULL,
                `rule_id` BINARY(16) NOT NULL,
                `version` INT NOT NULL,
                `condition` JSON NOT NULL,
                `action` JSON NOT NULL,
                `changed_by` VARCHAR(255) NULL,
                `change_note` LONGTEXT NULL,
                `changed_at` DATETIME(3) NOT NULL,
                `updated_at` DATETIME(3) NULL,
                PRIMARY KEY (`id`),
                KEY `idx.meta_clip_rule_version.rule_id` (`rule_id`),
                UNIQUE KEY `uniq.meta_clip_rule_version.rule_version` (`rule_id`, `version`),
                CONSTRAINT `fk.meta_clip_rule_version.rule_id`
                    FOREIGN KEY (`rule_id`) REFERENCES `meta_clip_rule` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            SQL
        );
    }

    public function updateDestructive(Connection $connection): void
    {
    }
}
