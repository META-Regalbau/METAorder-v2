<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\Geometry;

use Shopware\Core\Framework\DataAbstractionLayer\EntityCollection;

/**
 * @extends EntityCollection<GeometryEntity>
 */
class GeometryCollection extends EntityCollection
{
    protected function getExpectedClass(): string
    {
        return GeometryEntity::class;
    }
}
