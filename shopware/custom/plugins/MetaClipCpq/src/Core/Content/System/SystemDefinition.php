<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\System;

use Meta\ClipCpq\Core\Content\ComponentType\ComponentTypeDefinition;
use Meta\ClipCpq\Core\Content\Configuration\ConfigurationDefinition;
use Meta\ClipCpq\Core\Content\ProductMapping\ProductMappingDefinition;
use Meta\ClipCpq\Core\Content\Rule\RuleDefinition;
use Shopware\Core\Framework\DataAbstractionLayer\EntityDefinition;
use Shopware\Core\Framework\DataAbstractionLayer\Field\CreatedAtField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\FieldCollection;
use Shopware\Core\Framework\DataAbstractionLayer\Field\Flag\PrimaryKey;
use Shopware\Core\Framework\DataAbstractionLayer\Field\Flag\Required;
use Shopware\Core\Framework\DataAbstractionLayer\Field\IdField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\LongTextField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\OneToManyAssociationField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\StringField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\UpdatedAtField;

class SystemDefinition extends EntityDefinition
{
    public const ENTITY_NAME = 'meta_clip_system';

    public function getEntityName(): string
    {
        return self::ENTITY_NAME;
    }

    public function getEntityClass(): string
    {
        return SystemEntity::class;
    }

    public function getCollectionClass(): string
    {
        return SystemCollection::class;
    }

    protected function defineFields(): FieldCollection
    {
        return new FieldCollection([
            (new IdField('id', 'id'))->addFlags(new PrimaryKey(), new Required()),
            (new StringField('name', 'name'))->addFlags(new Required()),
            (new StringField('slug', 'slug'))->addFlags(new Required()),
            new LongTextField('description', 'description'),
            (new StringField('status', 'status'))->addFlags(new Required()),
            new OneToManyAssociationField('componentTypes', ComponentTypeDefinition::class, 'system_id', 'id'),
            new OneToManyAssociationField('productMappings', ProductMappingDefinition::class, 'system_id', 'id'),
            new OneToManyAssociationField('rules', RuleDefinition::class, 'system_id', 'id'),
            new OneToManyAssociationField('configurations', ConfigurationDefinition::class, 'system_id', 'id'),
            new CreatedAtField(),
            new UpdatedAtField(),
        ]);
    }
}
