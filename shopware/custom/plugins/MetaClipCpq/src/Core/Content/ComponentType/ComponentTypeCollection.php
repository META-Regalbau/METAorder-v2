<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\ComponentType;

use Shopware\Core\Framework\DataAbstractionLayer\EntityCollection;

/**
 * @extends EntityCollection<ComponentTypeEntity>
 */
class ComponentTypeCollection extends EntityCollection
{
    protected function getExpectedClass(): string
    {
        return ComponentTypeEntity::class;
    }
}
