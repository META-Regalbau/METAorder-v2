<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\ComponentType;

use Meta\ClipCpq\Core\Content\ProductMapping\ProductMappingDefinition;
use Meta\ClipCpq\Core\Content\System\SystemDefinition;
use Shopware\Core\Framework\DataAbstractionLayer\EntityDefinition;
use Shopware\Core\Framework\DataAbstractionLayer\Field\BoolField;
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

class ComponentTypeDefinition extends EntityDefinition
{
    public const ENTITY_NAME = 'meta_clip_component_type';

    public function getEntityName(): string
    {
        return self::ENTITY_NAME;
    }

    public function getEntityClass(): string
    {
        return ComponentTypeEntity::class;
    }

    public function getCollectionClass(): string
    {
        return ComponentTypeCollection::class;
    }

    protected function defineFields(): FieldCollection
    {
        return new FieldCollection([
            (new IdField('id', 'id'))->addFlags(new PrimaryKey(), new Required()),
            (new FkField('system_id', 'systemId', SystemDefinition::class))->addFlags(new Required()),
            (new StringField('name', 'name'))->addFlags(new Required()),
            (new StringField('role', 'role'))->addFlags(new Required()),
            (new BoolField('required', 'required'))->addFlags(new Required()),
            (new IntField('sort_order', 'sortOrder'))->addFlags(new Required()),
            new StringField('icon', 'icon'),
            new JsonField('attribute_schema', 'attributeSchema'),
            new ManyToOneAssociationField('system', 'system_id', SystemDefinition::class, 'id', false),
            new OneToManyAssociationField('productMappings', ProductMappingDefinition::class, 'component_type_id', 'id'),
            new CreatedAtField(),
            new UpdatedAtField(),
        ]);
    }
}
