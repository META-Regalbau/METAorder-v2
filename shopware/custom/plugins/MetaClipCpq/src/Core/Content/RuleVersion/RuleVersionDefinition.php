<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\RuleVersion;

use Meta\ClipCpq\Core\Content\Rule\RuleDefinition;
use Shopware\Core\Framework\DataAbstractionLayer\EntityDefinition;
use Shopware\Core\Framework\DataAbstractionLayer\Field\CreatedAtField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\FieldCollection;
use Shopware\Core\Framework\DataAbstractionLayer\Field\Flag\PrimaryKey;
use Shopware\Core\Framework\DataAbstractionLayer\Field\Flag\Required;
use Shopware\Core\Framework\DataAbstractionLayer\Field\FkField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\IdField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\IntField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\JsonField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\LongTextField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\ManyToOneAssociationField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\StringField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\UpdatedAtField;

class RuleVersionDefinition extends EntityDefinition
{
    public const ENTITY_NAME = 'meta_clip_rule_version';

    public function getEntityName(): string
    {
        return self::ENTITY_NAME;
    }

    public function getEntityClass(): string
    {
        return RuleVersionEntity::class;
    }

    public function getCollectionClass(): string
    {
        return RuleVersionCollection::class;
    }

    protected function defineFields(): FieldCollection
    {
        return new FieldCollection([
            (new IdField('id', 'id'))->addFlags(new PrimaryKey(), new Required()),
            (new FkField('rule_id', 'ruleId', RuleDefinition::class))->addFlags(new Required()),
            (new IntField('version', 'version'))->addFlags(new Required()),
            (new JsonField('condition', 'condition'))->addFlags(new Required()),
            (new JsonField('action', 'action'))->addFlags(new Required()),
            new StringField('changed_by', 'changedBy'),
            new LongTextField('change_note', 'changeNote'),
            new ManyToOneAssociationField('rule', 'rule_id', RuleDefinition::class, 'id', false),
            new CreatedAtField('changed_at'),
            new UpdatedAtField(),
        ]);
    }
}
