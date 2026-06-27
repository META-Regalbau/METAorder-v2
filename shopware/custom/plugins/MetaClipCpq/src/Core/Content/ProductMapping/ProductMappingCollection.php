<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\ProductMapping;

use Shopware\Core\Framework\DataAbstractionLayer\EntityCollection;

/**
 * @extends EntityCollection<ProductMappingEntity>
 */
class ProductMappingCollection extends EntityCollection
{
    protected function getExpectedClass(): string
    {
        return ProductMappingEntity::class;
    }
}
