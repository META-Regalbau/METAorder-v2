<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Migration;

use Doctrine\DBAL\Connection;
use Shopware\Core\Framework\Migration\MigrationStep;

class Migration202605040002CreateConfigurationReviewLogTable extends MigrationStep
{
    public function getCreationTimestamp(): int
    {
        return 202605040002;
    }

    public function update(Connection $connection): void
    {
        $connection->executeStatement(
            <<<'SQL'
            CREATE TABLE IF NOT EXISTS `meta_clip_configuration_review_log` (
                `id` BINARY(16) NOT NULL,
                `configuration_id` BINARY(16) NOT NULL,
                `actor_user_id` BINARY(16) NULL,
                `from_status` VARCHAR(64) NULL,
                `to_status` VARCHAR(64) NOT NULL,
                `action` VARCHAR(64) NOT NULL,
                `payload` JSON NULL,
                `created_at` DATETIME(3) NOT NULL,
                PRIMARY KEY (`id`),
                KEY `idx.meta_clip_configuration_review_log.configuration_id` (`configuration_id`),
                KEY `idx.meta_clip_configuration_review_log.actor_user_id` (`actor_user_id`),
                KEY `idx.meta_clip_configuration_review_log.to_status` (`to_status`),
                CONSTRAINT `fk.meta_clip_configuration_review_log.configuration_id`
                    FOREIGN KEY (`configuration_id`) REFERENCES `meta_clip_configuration` (`id`)
                    ON DELETE CASCADE ON UPDATE CASCADE,
                CONSTRAINT `fk.meta_clip_configuration_review_log.actor_user_id`
                    FOREIGN KEY (`actor_user_id`) REFERENCES `user` (`id`)
                    ON DELETE SET NULL ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            SQL
        );
    }

    public function updateDestructive(Connection $connection): void
    {
    }
}
