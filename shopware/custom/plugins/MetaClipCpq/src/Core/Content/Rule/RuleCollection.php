<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\Rule;

use Shopware\Core\Framework\DataAbstractionLayer\EntityCollection;

/**
 * @extends EntityCollection<RuleEntity>
 */
class RuleCollection extends EntityCollection
{
    protected function getExpectedClass(): string
    {
        return RuleEntity::class;
    }
}
