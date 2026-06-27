<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\RuleVersion;

use Shopware\Core\Framework\DataAbstractionLayer\EntityCollection;

/**
 * @extends EntityCollection<RuleVersionEntity>
 */
class RuleVersionCollection extends EntityCollection
{
    protected function getExpectedClass(): string
    {
        return RuleVersionEntity::class;
    }
}
