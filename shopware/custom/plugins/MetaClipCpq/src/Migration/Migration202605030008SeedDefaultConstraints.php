<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Migration;

use Doctrine\DBAL\Connection;
use Shopware\Core\Framework\Migration\MigrationStep;
use Shopware\Core\Framework\Uuid\Uuid;

class Migration202605030008SeedDefaultConstraints extends MigrationStep
{
    public function getCreationTimestamp(): int
    {
        return 202605030008;
    }

    public function update(Connection $connection): void
    {
        $systemId = $this->upsertDefaultSystem($connection);

        $this->seedRule(
            $connection,
            $systemId,
            'seed.compatibility.beam-1300-frame-depth',
            'Traverse 1300 passt auf CLIP-Steher 400/500',
            'compatibility',
            10,
            [
                'source' => ['component_type' => 'beam', 'attribute' => 'width', 'value' => 1300],
                'target' => ['component_type' => 'frame', 'attribute' => 'depth', 'operator' => 'in', 'value' => [400, 500]],
            ],
            ['type' => 'allow'],
            null,
            'Kompatibilitaet fuer Standard-CLIP-Traverse.'
        );

        $this->seedRule(
            $connection,
            $systemId,
            'seed.physical.wall-anchor-height',
            'Wandverankerung ab 2500mm',
            'physical',
            20,
            [
                'component_type' => 'frame',
                'attribute' => 'height',
                'operator' => '>',
                'value' => 2500,
            ],
            [
                'type' => 'require_component',
                'target_type' => 'accessory',
                'target_attribute' => 'subtype',
                'target_value' => 'wall_anchor',
            ],
            null,
            'Ab 2500mm Regalhoehe ist eine Wandverankerung vorgeschrieben.'
        );

        $this->seedRule(
            $connection,
            $systemId,
            'seed.configuration.frame-count',
            'Steher = Felder + 1',
            'configuration',
            30,
            ['calculation' => 'config.frame_quantity = config.field_count + 1'],
            ['type' => 'assign', 'target' => 'frame_quantity'],
            null,
            'Steheranzahl ergibt sich aus Felder + 1.'
        );

        $this->seedRule(
            $connection,
            $systemId,
            'seed.business.special-heights-inquiry',
            'Sonderhoehen nur auf Anfrage',
            'business',
            40,
            [
                'component_type' => 'frame',
                'attribute' => 'height',
                'operator' => 'not_in',
                'value' => [1800, 2000, 2200, 2500, 3000],
            ],
            ['type' => 'set_mode', 'value' => 'inquiry'],
            null,
            'Sonderhoehen sind nur auf Anfrage verfuegbar.'
        );
    }

    public function updateDestructive(Connection $connection): void
    {
    }

    private function upsertDefaultSystem(Connection $connection): string
    {
        $existingId = $connection->fetchOne(
            'SELECT LOWER(HEX(id)) FROM meta_clip_system WHERE slug = :slug LIMIT 1',
            ['slug' => 'meta-clip']
        );

        if (is_string($existingId) && $existingId !== '') {
            return $existingId;
        }

        $systemId = Uuid::randomHex();

        $connection->executeStatement(
            <<<'SQL'
            INSERT INTO `meta_clip_system` (`id`, `name`, `slug`, `description`, `status`, `created_at`, `updated_at`)
            VALUES (UNHEX(:id), :name, :slug, :description, :status, NOW(3), NOW(3))
            SQL,
            [
                'id' => $systemId,
                'name' => 'META CLIP',
                'slug' => 'meta-clip',
                'description' => 'Initiales Seed-System fuer Sprint 1+2.',
                'status' => 'active',
            ]
        );

        return $systemId;
    }

    /**
     * @param array<string, mixed> $condition
     * @param array<string, mixed> $action
     * @param array<string, mixed>|null $fallback
     */
    private function seedRule(
        Connection $connection,
        string $systemId,
        string $technicalKey,
        string $name,
        string $type,
        int $priority,
        array $condition,
        array $action,
        ?array $fallback,
        string $message
    ): void {
        $existingRuleId = $connection->fetchOne(
            <<<'SQL'
            SELECT LOWER(HEX(`id`))
            FROM `meta_clip_rule`
            WHERE `system_id` = UNHEX(:systemId)
              AND `technical_key` = :technicalKey
            LIMIT 1
            SQL,
            [
                'systemId' => $systemId,
                'technicalKey' => $technicalKey,
            ]
        );

        if (is_string($existingRuleId) && $existingRuleId !== '') {
            return;
        }

        $ruleId = Uuid::randomHex();

        $connection->executeStatement(
            <<<'SQL'
            INSERT INTO `meta_clip_rule` (
                `id`,
                `system_id`,
                `name`,
                `type`,
                `priority`,
                `condition`,
                `action`,
                `fallback`,
                `message`,
                `status`,
                `version`,
                `created_by`,
                `technical_key`,
                `created_at`,
                `updated_at`
            ) VALUES (
                UNHEX(:id),
                UNHEX(:systemId),
                :name,
                :type,
                :priority,
                :condition,
                :action,
                :fallback,
                :message,
                :status,
                :version,
                :createdBy,
                :technicalKey,
                NOW(3),
                NOW(3)
            )
            SQL,
            [
                'id' => $ruleId,
                'systemId' => $systemId,
                'name' => $name,
                'type' => $type,
                'priority' => $priority,
                'condition' => json_encode($condition, JSON_THROW_ON_ERROR),
                'action' => json_encode($action, JSON_THROW_ON_ERROR),
                'fallback' => $fallback === null ? null : json_encode($fallback, JSON_THROW_ON_ERROR),
                'message' => $message,
                'status' => 'active',
                'version' => 1,
                'createdBy' => 'seed:migration',
                'technicalKey' => $technicalKey,
            ]
        );

        $connection->executeStatement(
            <<<'SQL'
            INSERT INTO `meta_clip_rule_version` (
                `id`,
                `rule_id`,
                `version`,
                `condition`,
                `action`,
                `changed_by`,
                `change_note`,
                `changed_at`,
                `updated_at`
            ) VALUES (
                UNHEX(:id),
                UNHEX(:ruleId),
                :version,
                :condition,
                :action,
                :changedBy,
                :changeNote,
                NOW(3),
                NOW(3)
            )
            SQL,
            [
                'id' => Uuid::randomHex(),
                'ruleId' => $ruleId,
                'version' => 1,
                'condition' => json_encode($condition, JSON_THROW_ON_ERROR),
                'action' => json_encode($action, JSON_THROW_ON_ERROR),
                'changedBy' => 'seed:migration',
                'changeNote' => 'Initiale Seed-Regel.',
            ]
        );
    }
}
