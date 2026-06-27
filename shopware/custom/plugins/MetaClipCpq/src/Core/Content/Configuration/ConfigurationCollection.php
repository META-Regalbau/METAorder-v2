<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\Configuration;

use Shopware\Core\Framework\DataAbstractionLayer\EntityCollection;

/**
 * @extends EntityCollection<ConfigurationEntity>
 */
class ConfigurationCollection extends EntityCollection
{
    protected function getExpectedClass(): string
    {
        return ConfigurationEntity::class;
    }
}
