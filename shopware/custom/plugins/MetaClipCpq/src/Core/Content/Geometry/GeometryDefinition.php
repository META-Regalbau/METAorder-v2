<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\Geometry;

use Meta\ClipCpq\Core\Content\ProductMapping\ProductMappingDefinition;
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
use Shopware\Core\Framework\DataAbstractionLayer\Field\UpdatedAtField;

class GeometryDefinition extends EntityDefinition
{
    public const ENTITY_NAME = 'meta_clip_geometry';

    public function getEntityName(): string
    {
        return self::ENTITY_NAME;
    }

    public function getEntityClass(): string
    {
        return GeometryEntity::class;
    }

    public function getCollectionClass(): string
    {
        return GeometryCollection::class;
    }

    protected function defineFields(): FieldCollection
    {
        return new FieldCollection([
            (new IdField('id', 'id'))->addFlags(new PrimaryKey(), new Required()),
            (new FkField('product_mapping_id', 'productMappingId', ProductMappingDefinition::class))->addFlags(new Required()),
            new JsonField('origin', 'origin'),
            new JsonField('anchor_points', 'anchorPoints'),
            new JsonField('bounding_box', 'boundingBox'),
            new StringField('glb_asset_url', 'glbAssetUrl'),
            new JsonField('lod_levels', 'lodLevels'),
            new ManyToOneAssociationField('productMapping', 'product_mapping_id', ProductMappingDefinition::class, 'id', false),
            new CreatedAtField(),
            new UpdatedAtField(),
        ]);
    }
}
