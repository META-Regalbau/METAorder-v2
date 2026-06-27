<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Migration;

use Doctrine\DBAL\Connection;
use Shopware\Core\Framework\Migration\MigrationStep;

class Migration202605030001CreateSystemTable extends MigrationStep
{
    public function getCreationTimestamp(): int
    {
        return 202605030001;
    }

    public function update(Connection $connection): void
    {
        $connection->executeStatement(
            <<<'SQL'
            CREATE TABLE IF NOT EXISTS `meta_clip_system` (
                `id` BINARY(16) NOT NULL,
                `name` VARCHAR(255) NOT NULL,
                `slug` VARCHAR(255) NOT NULL,
                `description` LONGTEXT NULL,
                `status` VARCHAR(32) NOT NULL,
                `created_at` DATETIME(3) NOT NULL,
                `updated_at` DATETIME(3) NULL,
                PRIMARY KEY (`id`),
                UNIQUE KEY `uniq.meta_clip_system.slug` (`slug`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            SQL
        );
    }

    public function updateDestructive(Connection $connection): void
    {
    }
}
