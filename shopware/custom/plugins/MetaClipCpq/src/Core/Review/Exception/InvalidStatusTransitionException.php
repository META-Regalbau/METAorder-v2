<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Review\Exception;

final class InvalidStatusTransitionException extends \RuntimeException
{
    public function __construct(string $fromStatus, string $toStatus)
    {
        parent::__construct(sprintf('Invalid review status transition from "%s" to "%s".', $fromStatus, $toStatus));
    }
}
