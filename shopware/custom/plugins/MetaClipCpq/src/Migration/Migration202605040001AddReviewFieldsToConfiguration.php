<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Migration;

use Doctrine\DBAL\Connection;
use Shopware\Core\Framework\Migration\MigrationStep;

class Migration202605040001AddReviewFieldsToConfiguration extends MigrationStep
{
    public function getCreationTimestamp(): int
    {
        return 1777852860; // 2026-05-04, Schritt 1
    }

    public function update(Connection $connection): void
    {
        // Einzeln mit Vorabprüfung statt ADD COLUMN IF NOT EXISTS — das kann nur MariaDB, nicht MySQL.
        $columns = [
            'assigned_to' => 'BINARY(16) NULL AFTER `validation_status`',
            'assigned_at' => 'DATETIME(3) NULL AFTER `assigned_to`',
            'completed_at' => 'DATETIME(3) NULL AFTER `assigned_at`',
            'outcome' => 'VARCHAR(64) NULL AFTER `completed_at`',
            'notes' => 'LONGTEXT NULL AFTER `outcome`',
        ];
        foreach ($columns as $column => $definition) {
            if (!$this->hasColumn($connection, 'meta_clip_configuration', $column)) {
                $connection->executeStatement(
                    sprintf('ALTER TABLE `meta_clip_configuration` ADD COLUMN `%s` %s', $column, $definition)
                );
            }
        }

        if (!$this->hasIndex($connection, 'meta_clip_configuration', 'idx.meta_clip_configuration.assigned_to')) {
            $connection->executeStatement(
                'CREATE INDEX `idx.meta_clip_configuration.assigned_to` ON `meta_clip_configuration` (`assigned_to`)'
            );
        }
        if (!$this->hasIndex($connection, 'meta_clip_configuration', 'idx.meta_clip_configuration.outcome')) {
            $connection->executeStatement(
                'CREATE INDEX `idx.meta_clip_configuration.outcome` ON `meta_clip_configuration` (`outcome`)'
            );
        }

        if (!$this->hasConstraint($connection, 'meta_clip_configuration', 'fk.meta_clip_configuration.assigned_to')) {
            $connection->executeStatement(
                <<<'SQL'
                ALTER TABLE `meta_clip_configuration`
                ADD CONSTRAINT `fk.meta_clip_configuration.assigned_to`
                    FOREIGN KEY (`assigned_to`) REFERENCES `user` (`id`)
                    ON DELETE SET NULL ON UPDATE CASCADE;
                SQL
            );
        }
    }

    public function updateDestructive(Connection $connection): void
    {
    }

    private function hasConstraint(Connection $connection, string $table, string $constraint): bool
    {
        return (int) $connection->fetchOne(
            <<<'SQL'
            SELECT COUNT(*)
            FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = :tableName
              AND CONSTRAINT_NAME = :constraintName
            SQL,
            [
                'tableName' => $table,
                'constraintName' => $constraint,
            ]
        ) > 0;
    }

    private function hasColumn(Connection $connection, string $table, string $column): bool
    {
        return (int) $connection->fetchOne(
            <<<'SQL'
            SELECT COUNT(*)
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = :tableName
              AND COLUMN_NAME = :columnName
            SQL,
            [
                'tableName' => $table,
                'columnName' => $column,
            ]
        ) > 0;
    }

    private function hasIndex(Connection $connection, string $table, string $index): bool
    {
        return (int) $connection->fetchOne(
            <<<'SQL'
            SELECT COUNT(*)
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = :tableName
              AND INDEX_NAME = :indexName
            SQL,
            [
                'tableName' => $table,
                'indexName' => $index,
            ]
        ) > 0;
    }
}
