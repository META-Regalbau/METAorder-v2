<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\Rule;

use Meta\ClipCpq\Core\Content\RuleVersion\RuleVersionDefinition;
use Meta\ClipCpq\Core\Content\System\SystemDefinition;
use Shopware\Core\Framework\DataAbstractionLayer\EntityDefinition;
use Shopware\Core\Framework\DataAbstractionLayer\Field\CreatedAtField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\FieldCollection;
use Shopware\Core\Framework\DataAbstractionLayer\Field\Flag\PrimaryKey;
use Shopware\Core\Framework\DataAbstractionLayer\Field\Flag\Required;
use Shopware\Core\Framework\DataAbstractionLayer\Field\FkField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\IdField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\IntField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\JsonField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\ManyToOneAssociationField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\OneToManyAssociationField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\StringField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\UpdatedAtField;

class RuleDefinition extends EntityDefinition
{
    public const ENTITY_NAME = 'meta_clip_rule';

    public function getEntityName(): string
    {
        return self::ENTITY_NAME;
    }

    public function getEntityClass(): string
    {
        return RuleEntity::class;
    }

    public function getCollectionClass(): string
    {
        return RuleCollection::class;
    }

    protected function defineFields(): FieldCollection
    {
        return new FieldCollection([
            (new IdField('id', 'id'))->addFlags(new PrimaryKey(), new Required()),
            (new FkField('system_id', 'systemId', SystemDefinition::class))->addFlags(new Required()),
            (new StringField('name', 'name'))->addFlags(new Required()),
            (new StringField('type', 'type'))->addFlags(new Required()),
            (new IntField('priority', 'priority'))->addFlags(new Required()),
            (new JsonField('condition', 'condition'))->addFlags(new Required()),
            (new JsonField('action', 'action'))->addFlags(new Required()),
            new JsonField('fallback', 'fallback'),
            new StringField('message', 'message'),
            (new StringField('status', 'status'))->addFlags(new Required()),
            (new IntField('version', 'version'))->addFlags(new Required()),
            new StringField('created_by', 'createdBy'),
            new StringField('technical_key', 'technicalKey'),
            new ManyToOneAssociationField('system', 'system_id', SystemDefinition::class, 'id', false),
            new OneToManyAssociationField('versions', RuleVersionDefinition::class, 'rule_id', 'id'),
            new CreatedAtField(),
            new UpdatedAtField(),
        ]);
    }
}
