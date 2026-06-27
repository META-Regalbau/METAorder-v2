<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\ConfigurationReviewLog;

use Shopware\Core\Framework\DataAbstractionLayer\EntityCollection;

/**
 * @extends EntityCollection<ConfigurationReviewLogEntity>
 */
class ConfigurationReviewLogCollection extends EntityCollection
{
    protected function getExpectedClass(): string
    {
        return ConfigurationReviewLogEntity::class;
    }
}
