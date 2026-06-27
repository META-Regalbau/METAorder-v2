<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\System;

use Shopware\Core\Framework\DataAbstractionLayer\EntityCollection;

/**
 * @extends EntityCollection<SystemEntity>
 */
class SystemCollection extends EntityCollection
{
    protected function getExpectedClass(): string
    {
        return SystemEntity::class;
    }
}
