<?php

declare(strict_types=1);

namespace Meta\ClipCpq\Core\Content\Configuration;

use Meta\ClipCpq\Core\Content\ConfigurationReviewLog\ConfigurationReviewLogDefinition;
use Meta\ClipCpq\Core\Content\System\SystemDefinition;
use Shopware\Core\Checkout\Customer\CustomerDefinition;
use Shopware\Core\Checkout\Order\OrderDefinition;
use Shopware\Core\Framework\DataAbstractionLayer\EntityDefinition;
use Shopware\Core\Framework\DataAbstractionLayer\Field\CreatedAtField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\DateTimeField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\FieldCollection;
use Shopware\Core\Framework\DataAbstractionLayer\Field\Flag\PrimaryKey;
use Shopware\Core\Framework\DataAbstractionLayer\Field\Flag\Required;
use Shopware\Core\Framework\DataAbstractionLayer\Field\FloatField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\FkField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\IdField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\JsonField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\ManyToOneAssociationField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\OneToManyAssociationField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\StringField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\UpdatedAtField;
use Shopware\Core\Framework\DataAbstractionLayer\Field\LongTextField;
use Shopware\Core\System\User\UserDefinition;
use Shopware\Core\System\SalesChannel\SalesChannelDefinition;

class ConfigurationDefinition extends EntityDefinition
{
    public const ENTITY_NAME = 'meta_clip_configuration';

    public function getEntityName(): string
    {
        return self::ENTITY_NAME;
    }

    public function getEntityClass(): string
    {
        return ConfigurationEntity::class;
    }

    public function getCollectionClass(): string
    {
        return ConfigurationCollection::class;
    }

    protected function defineFields(): FieldCollection
    {
        return new FieldCollection([
            (new IdField('id', 'id'))->addFlags(new PrimaryKey(), new Required()),
            (new FkField('system_id', 'systemId', SystemDefinition::class))->addFlags(new Required()),
            new FkField('customer_id', 'customerId', CustomerDefinition::class),
            new FkField('order_id', 'orderId', OrderDefinition::class),
            new FkField('sales_channel_id', 'salesChannelId', SalesChannelDefinition::class),
            (new StringField('name', 'name'))->addFlags(new Required()),
            (new JsonField('config_data', 'configData'))->addFlags(new Required()),
            (new StringField('validation_status', 'validationStatus'))->addFlags(new Required()),
            new FkField('assigned_to', 'assignedTo', UserDefinition::class),
            new DateTimeField('assigned_at', 'assignedAt'),
            new DateTimeField('completed_at', 'completedAt'),
            new StringField('outcome', 'outcome'),
            new LongTextField('notes', 'notes'),
            (new FloatField('total_price', 'totalPrice'))->addFlags(new Required()),
            new ManyToOneAssociationField('system', 'system_id', SystemDefinition::class, 'id', false),
            new ManyToOneAssociationField('customer', 'customer_id', CustomerDefinition::class, 'id', false),
            new ManyToOneAssociationField('order', 'order_id', OrderDefinition::class, 'id', false),
            new ManyToOneAssociationField('salesChannel', 'sales_channel_id', SalesChannelDefinition::class, 'id', false),
            new ManyToOneAssociationField('assignedUser', 'assigned_to', UserDefinition::class, 'id', false),
            new OneToManyAssociationField('reviewLogs', ConfigurationReviewLogDefinition::class, 'configuration_id', 'id'),
            new CreatedAtField(),
            new UpdatedAtField(),
        ]);
    }
}
