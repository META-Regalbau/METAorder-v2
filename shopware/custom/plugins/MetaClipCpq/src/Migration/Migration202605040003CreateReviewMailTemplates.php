<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Migration;

use Doctrine\DBAL\Connection;
use Shopware\Core\Defaults;
use Shopware\Core\Framework\Migration\MigrationStep;
use Shopware\Core\Framework\Uuid\Uuid;

class Migration202605040003CreateReviewMailTemplates extends MigrationStep
{
    public function getCreationTimestamp(): int
    {
        return 202605040003;
    }

    public function update(Connection $connection): void
    {
        $languageRows = $connection->fetchAllKeyValue(
            <<<'SQL'
            SELECT LOWER(HEX(`id`)), `locale`.`code`
            FROM `language`
            INNER JOIN `locale` ON `locale`.`id` = `language`.`locale_id`
            WHERE `locale`.`code` IN ('de-DE', 'en-GB');
            SQL
        );

        $technicalTypes = [
            'meta_clip_review.received' => ['review.received', 'Review erhalten', 'Review received'],
            'meta_clip_review.approved' => ['review.approved', 'Review freigegeben', 'Review approved'],
            'meta_clip_review.contact_requested' => ['review.contact_requested', 'Rueckfrage erforderlich', 'Customer contact required'],
            'meta_clip_review.rejected' => ['review.rejected', 'Review abgelehnt', 'Review rejected'],
        ];

        foreach ($technicalTypes as $mailTypeTechnicalName => [$eventName, $deName, $enName]) {
            $mailTypeId = $this->upsertMailTemplateType($connection, $mailTypeTechnicalName, $eventName, $deName, $enName, $languageRows);
            $this->upsertMailTemplate(
                $connection,
                $mailTypeId,
                $mailTypeTechnicalName,
                [
                    'de-DE' => [
                        'subject' => sprintf('META CLIP: %s', $deName),
                        'description' => sprintf('Automatische Nachricht fuer %s', $deName),
                        'contentHtml' => '<p>Hallo {{ customer.firstName }} {{ customer.lastName }},</p><p>Ihre META CLIP Konfiguration {{ configuration.name }} wurde aktualisiert.</p><p>Status: ' . $eventName . '</p>',
                        'contentPlain' => "Hallo {{ customer.firstName }} {{ customer.lastName }},\nIhre META CLIP Konfiguration {{ configuration.name }} wurde aktualisiert.\nStatus: " . $eventName,
                    ],
                    'en-GB' => [
                        'subject' => sprintf('META CLIP: %s', $enName),
                        'description' => sprintf('Automated mail for %s', $enName),
                        'contentHtml' => '<p>Hello {{ customer.firstName }} {{ customer.lastName }},</p><p>Your META CLIP configuration {{ configuration.name }} has been updated.</p><p>Status: ' . $eventName . '</p>',
                        'contentPlain' => "Hello {{ customer.firstName }} {{ customer.lastName }},\nYour META CLIP configuration {{ configuration.name }} has been updated.\nStatus: " . $eventName,
                    ],
                ],
                $languageRows
            );
        }
    }

    public function updateDestructive(Connection $connection): void
    {
    }

    /**
     * @param array<string, string> $languageRows
     */
    private function upsertMailTemplateType(
        Connection $connection,
        string $technicalName,
        string $eventName,
        string $deName,
        string $enName,
        array $languageRows
    ): string {
        $existing = $connection->fetchOne(
            'SELECT LOWER(HEX(`id`)) FROM `mail_template_type` WHERE `technical_name` = :technicalName',
            ['technicalName' => $technicalName]
        );
        $mailTypeId = is_string($existing) ? $existing : Uuid::randomHex();

        $connection->executeStatement(
            <<<'SQL'
            INSERT INTO `mail_template_type` (`id`, `technical_name`, `available_entities`, `created_at`)
            VALUES (UNHEX(:id), :technicalName, :availableEntities, :createdAt)
            ON DUPLICATE KEY UPDATE `available_entities` = VALUES(`available_entities`);
            SQL,
            [
                'id' => $mailTypeId,
                'technicalName' => $technicalName,
                'availableEntities' => json_encode([
                    'customer' => 'customer',
                    'configuration' => 'meta_clip_configuration',
                    'order' => 'order',
                ], \JSON_THROW_ON_ERROR),
                'createdAt' => (new \DateTimeImmutable())->format(Defaults::STORAGE_DATE_TIME_FORMAT),
            ]
        );

        $this->upsertMailTypeTranslation($connection, $mailTypeId, $languageRows['de-DE'] ?? null, $deName, $eventName);
        $this->upsertMailTypeTranslation($connection, $mailTypeId, $languageRows['en-GB'] ?? null, $enName, $eventName);

        return $mailTypeId;
    }

    /**
     * @param array<string, array<string, string>> $translations
     * @param array<string, string> $languageRows
     */
    private function upsertMailTemplate(
        Connection $connection,
        string $mailTypeId,
        string $technicalName,
        array $translations,
        array $languageRows
    ): void {
        $existing = $connection->fetchOne(
            'SELECT LOWER(HEX(`id`)) FROM `mail_template` WHERE `mail_template_type_id` = UNHEX(:mailTypeId)',
            ['mailTypeId' => $mailTypeId]
        );
        $mailTemplateId = is_string($existing) ? $existing : Uuid::randomHex();
        $createdAt = (new \DateTimeImmutable())->format(Defaults::STORAGE_DATE_TIME_FORMAT);

        $connection->executeStatement(
            <<<'SQL'
            INSERT INTO `mail_template` (`id`, `mail_template_type_id`, `system_default`, `created_at`)
            VALUES (UNHEX(:id), UNHEX(:mailTypeId), 0, :createdAt)
            ON DUPLICATE KEY UPDATE `mail_template_type_id` = VALUES(`mail_template_type_id`);
            SQL,
            [
                'id' => $mailTemplateId,
                'mailTypeId' => $mailTypeId,
                'createdAt' => $createdAt,
            ]
        );

        foreach ($translations as $localeCode => $translation) {
            $languageId = $languageRows[$localeCode] ?? null;
            if ($languageId === null) {
                continue;
            }

            $connection->executeStatement(
                <<<'SQL'
                INSERT INTO `mail_template_translation`
                    (`mail_template_id`, `language_id`, `sender_name`, `subject`, `description`, `content_html`, `content_plain`, `created_at`)
                VALUES
                    (UNHEX(:mailTemplateId), UNHEX(:languageId), :senderName, :subject, :description, :contentHtml, :contentPlain, :createdAt)
                ON DUPLICATE KEY UPDATE
                    `subject` = VALUES(`subject`),
                    `description` = VALUES(`description`),
                    `content_html` = VALUES(`content_html`),
                    `content_plain` = VALUES(`content_plain`);
                SQL,
                [
                    'mailTemplateId' => $mailTemplateId,
                    'languageId' => $languageId,
                    'senderName' => 'META CLIP',
                    'subject' => $translation['subject'],
                    'description' => $translation['description'],
                    'contentHtml' => $translation['contentHtml'],
                    'contentPlain' => $translation['contentPlain'],
                    'createdAt' => $createdAt,
                ]
            );
        }
    }

    private function upsertMailTypeTranslation(
        Connection $connection,
        string $mailTypeId,
        ?string $languageId,
        string $name,
        string $customFields
    ): void {
        if ($languageId === null) {
            return;
        }

        $connection->executeStatement(
            <<<'SQL'
            INSERT INTO `mail_template_type_translation`
                (`mail_template_type_id`, `language_id`, `name`, `custom_fields`, `created_at`)
            VALUES
                (UNHEX(:mailTypeId), UNHEX(:languageId), :name, :customFields, :createdAt)
            ON DUPLICATE KEY UPDATE
                `name` = VALUES(`name`),
                `custom_fields` = VALUES(`custom_fields`);
            SQL,
            [
                'mailTypeId' => $mailTypeId,
                'languageId' => $languageId,
                'name' => $name,
                'customFields' => json_encode(['meta_clip_event' => $customFields], \JSON_THROW_ON_ERROR),
                'createdAt' => (new \DateTimeImmutable())->format(Defaults::STORAGE_DATE_TIME_FORMAT),
            ]
        );
    }
}
