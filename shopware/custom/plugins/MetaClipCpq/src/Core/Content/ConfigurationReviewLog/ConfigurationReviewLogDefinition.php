<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\ConfigurationReviewLog;

use Meta\ClipCpq\Core\Content\Configuration\ConfigurationDefinition;
use Shopware\Core\Framework\DataAbstractionLayer\EntityDefinition;
use Shopware\Core\Framework\DataAbstractionLayer\Field\CreatedAtField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\FieldCollection;
use Shopware\Core\Framework\DataAbstractionLayer\Field\Flag\PrimaryKey;
use Shopware\Core\Framework\DataAbstractionLayer\Field\Flag\Required;
use Shopware\Core\Framework\DataAbstractionLayer\Field\FkField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\IdField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\JsonField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\ManyToOneAssociationField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\StringField;
use Shopware\Core\System\User\UserDefinition;

class ConfigurationReviewLogDefinition extends EntityDefinition
{
    public const ENTITY_NAME = 'meta_clip_configuration_review_log';

    public function getEntityName(): string
    {
        return self::ENTITY_NAME;
    }

    public function getEntityClass(): string
    {
        return ConfigurationReviewLogEntity::class;
    }

    public function getCollectionClass(): string
    {
        return ConfigurationReviewLogCollection::class;
    }

    protected function defineFields(): FieldCollection
    {
        return new FieldCollection([
            (new IdField('id', 'id'))->addFlags(new PrimaryKey(), new Required()),
            (new FkField('configuration_id', 'configurationId', ConfigurationDefinition::class))->addFlags(new Required()),
            new FkField('actor_user_id', 'actorUserId', UserDefinition::class),
            new StringField('from_status', 'fromStatus'),
            (new StringField('to_status', 'toStatus'))->addFlags(new Required()),
            (new StringField('action', 'action'))->addFlags(new Required()),
            new JsonField('payload', 'payload'),
            new ManyToOneAssociationField('configuration', 'configuration_id', ConfigurationDefinition::class, 'id', false),
            new ManyToOneAssociationField('actorUser', 'actor_user_id', UserDefinition::class, 'id', false),
            new CreatedAtField(),
        ]);
    }
}
