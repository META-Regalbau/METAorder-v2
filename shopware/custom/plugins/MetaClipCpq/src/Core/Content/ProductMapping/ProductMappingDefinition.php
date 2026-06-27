<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\ProductMapping;

use Meta\ClipCpq\Core\Content\ComponentType\ComponentTypeDefinition;
use Meta\ClipCpq\Core\Content\Geometry\GeometryDefinition;
use Meta\ClipCpq\Core\Content\System\SystemDefinition;
use Shopware\Core\Framework\DataAbstractionLayer\EntityDefinition;
use Shopware\Core\Framework\DataAbstractionLayer\Field\CreatedAtField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\FieldCollection;
use Shopware\Core\Framework\DataAbstractionLayer\Field\Flag\PrimaryKey;
use Shopware\Core\Framework\DataAbstractionLayer\Field\Flag\Required;
use Shopware\Core\Framework\DataAbstractionLayer\Field\FkField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\IdField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\JsonField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\ManyToOneAssociationField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\OneToManyAssociationField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\StringField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\UpdatedAtField;

class ProductMappingDefinition extends EntityDefinition
{
    public const ENTITY_NAME = 'meta_clip_product_mapping';

    public function getEntityName(): string
    {
        return self::ENTITY_NAME;
    }

    public function getEntityClass(): string
    {
        return ProductMappingEntity::class;
    }

    public function getCollectionClass(): string
    {
        return ProductMappingCollection::class;
    }

    protected function defineFields(): FieldCollection
    {
        return new FieldCollection([
            (new IdField('id', 'id'))->addFlags(new PrimaryKey(), new Required()),
            (new StringField('shopware_product_id', 'shopwareProductId'))->addFlags(new Required()),
            (new StringField('shopware_product_number', 'shopwareProductNumber'))->addFlags(new Required()),
            (new FkField('system_id', 'systemId', SystemDefinition::class))->addFlags(new Required()),
            (new FkField('component_type_id', 'componentTypeId', ComponentTypeDefinition::class))->addFlags(new Required()),
            new JsonField('attributes', 'attributes'),
            (new StringField('status', 'status'))->addFlags(new Required()),
            new ManyToOneAssociationField('system', 'system_id', SystemDefinition::class, 'id', false),
            new ManyToOneAssociationField('componentType', 'component_type_id', ComponentTypeDefinition::class, 'id', false),
            new OneToManyAssociationField('geometries', GeometryDefinition::class, 'product_mapping_id', 'id'),
            new CreatedAtField(),
            new UpdatedAtField(),
        ]);
    }
}
