<?php

declare(strict_types=1);

namespace Meta\CartSignal\Subscriber;

use Meta\CartSignal\Core\CartSignalPayload;
use Meta\CartSignal\Core\CartSignalSender;
use Meta\CartSignal\Core\CartSignalSettings;
use Meta\CartSignal\Core\Message\CartSignalMessage;
use Psr\Log\LoggerInterface;
use Shopware\Core\Checkout\Cart\Cart;
use Shopware\Core\Checkout\Cart\Event\CartSavedEvent;
use Shopware\Core\Checkout\Cart\Event\CheckoutOrderPlacedEvent;
use Shopware\Core\Checkout\Cart\LineItem\LineItem;
use Shopware\Core\Checkout\Cart\Price\Struct\CartPrice;
use Shopware\Core\Checkout\Customer\CustomerEntity;
use Shopware\Core\System\SalesChannel\SalesChannelContext;
use Shopware\Core\System\SystemConfig\SystemConfigService;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\Messenger\MessageBusInterface;

/**
 * Hört auf gespeicherte Warenkörbe und abgeschlossene Bestellungen. Nur angemeldete Kunden (keine Gäste), nur
 * Geschäftskunden (Firma oder B2B-Kennzeichen), Warenkörbe erst ab dem eingestellten Mindestwert netto.
 *
 * Gesendet wird nie im Kaufablauf selbst: über die Message Queue (Standard) oder nach dem Ausliefern der
 * Antwort (kernel.terminate). Jeder Fehler hier wird geschluckt und nur protokolliert.
 */
class CartSignalSubscriber implements EventSubscriberInterface
{
    private const CONFIG_PREFIX = 'MetaCartSignal.config.';

    /** @var array<string, array{settings: CartSignalSettings, body: string}> je Kunde die letzte Meldung dieser Anfrage */
    private array $pending = [];

    /** @var array<string, string> je Kunde der Inhalt der zuletzt gemeldeten Meldung (Shopware speichert je Anfrage mehrfach) */
    private array $lastContent = [];

    public function __construct(
        private readonly SystemConfigService $systemConfig,
        private readonly MessageBusInterface $bus,
        private readonly CartSignalSender $sender,
        private readonly LoggerInterface $logger,
    ) {
    }

    public static function getSubscribedEvents(): array
    {
        return [
            CartSavedEvent::class => 'onCartSaved',
            CheckoutOrderPlacedEvent::class => 'onOrderPlaced',
            KernelEvents::TERMINATE => 'onTerminate',
        ];
    }

    public static function settings(SystemConfigService $config, ?string $salesChannelId): CartSignalSettings
    {
        $values = [];
        foreach (['active', 'endpointUrl', 'tenantId', 'secret', 'minNetTotal', 'timeoutSeconds', 'delivery', 'b2bFlagField'] as $key) {
            $values[$key] = $config->get(self::CONFIG_PREFIX . $key, $salesChannelId);
        }

        return CartSignalSettings::fromArray($values);
    }

    public function onCartSaved(CartSavedEvent $event): void
    {
        try {
            $context = $event->getSalesChannelContext();
            $settings = self::settings($this->systemConfig, $context->getSalesChannelId());
            $customer = $context->getCustomer();
            if (!$settings->isUsable() || !$this->isBusiness($customer, $settings)) {
                return;
            }
            $positions = $this->positions($event->getCart(), $context);
            $net = array_sum(array_column($positions, 'netTotal'));
            if (!$positions || $net < $settings->minNetTotal) {
                return;
            }
            $content = md5(serialize($positions));
            if (($this->lastContent[$customer->getId()] ?? null) === $content) {
                return;
            }
            $this->lastContent[$customer->getId()] = $content;
            $payload = CartSignalPayload::cartSaved($this->customerData($customer), $positions, $context->getCurrency()->getIsoCode(), $context->getSalesChannelId(), new \DateTimeImmutable());
            $this->deliver($settings, $customer->getId(), CartSignalPayload::encode($payload), $context->getSalesChannelId());
        } catch (\Throwable $e) {
            $this->logger->warning('META Warenkorb-Signal: Warenkorb nicht gemeldet', ['error' => mb_substr($e->getMessage(), 0, 300)]);
        }
    }

    public function onOrderPlaced(CheckoutOrderPlacedEvent $event): void
    {
        try {
            $salesChannelId = $event->getSalesChannelId();
            $settings = self::settings($this->systemConfig, $salesChannelId);
            $order = $event->getOrder();
            $oc = $order->getOrderCustomer();
            if (!$settings->isUsable() || !$oc || trim((string) $oc->getCustomerNumber()) === '') {
                return;
            }
            $customer = $oc->getCustomer();
            if ($customer instanceof CustomerEntity && !$this->isBusiness($customer, $settings)) {
                return;
            }
            if (!$customer instanceof CustomerEntity && trim((string) $oc->getCompany()) === '') {
                return;
            }
            $data = [
                'id' => (string) $oc->getCustomerId(),
                'customerNumber' => (string) $oc->getCustomerNumber(),
                'company' => (string) $oc->getCompany(),
                'firstName' => (string) $oc->getFirstName(),
                'lastName' => (string) $oc->getLastName(),
                'email' => (string) $oc->getEmail(),
                'phone' => null,
            ];
            $payload = CartSignalPayload::orderPlaced($data, (string) $order->getOrderNumber(), $salesChannelId, new \DateTimeImmutable());
            $this->deliver($settings, $data['id'] . ':order', CartSignalPayload::encode($payload), $salesChannelId);
        } catch (\Throwable $e) {
            $this->logger->warning('META Warenkorb-Signal: Bestellung nicht gemeldet', ['error' => mb_substr($e->getMessage(), 0, 300)]);
        }
    }

    /** Modus „am Ende der Anfrage“: nach dem Ausliefern der Antwort senden */
    public function onTerminate(): void
    {
        $pending = $this->pending;
        $this->pending = [];
        foreach ($pending as $item) {
            $this->sender->send($item['settings'], $item['body']);
        }
    }

    private function deliver(CartSignalSettings $settings, string $key, string $body, string $salesChannelId): void
    {
        if ($settings->delivery === CartSignalSettings::DELIVERY_TERMINATE) {
            $this->pending[$key] = ['settings' => $settings, 'body' => $body];

            return;
        }
        $this->bus->dispatch(new CartSignalMessage($body, $salesChannelId));
    }

    private function isBusiness(?CustomerEntity $customer, CartSignalSettings $settings): bool
    {
        if (!$customer instanceof CustomerEntity || $customer->getGuest()) {
            return false;
        }

        return CartSignalPayload::isBusinessCustomer($customer->getCompany(), $customer->getActiveBillingAddress()?->getCompany(), $customer->getCustomFields() ?? [], $settings->b2bFlagField);
    }

    /**
     * @return array{id: string, customerNumber: string, company: string, firstName: string, lastName: string, email: string, phone: ?string}
     */
    private function customerData(CustomerEntity $customer): array
    {
        $billing = $customer->getActiveBillingAddress();

        return [
            'id' => $customer->getId(),
            'customerNumber' => $customer->getCustomerNumber(),
            'company' => (string) ($customer->getCompany() ?: $billing?->getCompany()),
            'firstName' => $customer->getFirstName(),
            'lastName' => $customer->getLastName(),
            'email' => $customer->getEmail(),
            'phone' => $billing?->getPhoneNumber(),
        ];
    }

    /**
     * Artikelpositionen mit Netto-Summe (bei Bruttopreisen abzüglich der berechneten Steuer)
     *
     * @return list<array{productNumber: string, label: string, quantity: int, netTotal: float}>
     */
    private function positions(Cart $cart, SalesChannelContext $context): array
    {
        $gross = $context->getTaxState() === CartPrice::TAX_STATE_GROSS;
        $out = [];
        foreach ($cart->getLineItems()->filterFlatByType(LineItem::PRODUCT_LINE_ITEM_TYPE) as $item) {
            $price = $item->getPrice();
            if ($price === null) {
                continue;
            }
            $total = $price->getTotalPrice();
            $net = $gross ? $total - $price->getCalculatedTaxes()->getAmount() : $total;
            $number = $item->getPayloadValue('productNumber');
            $out[] = [
                'productNumber' => \is_string($number) ? $number : (string) $item->getReferencedId(),
                'label' => (string) $item->getLabel(),
                'quantity' => $item->getQuantity(),
                'netTotal' => round($net, 2),
            ];
        }

        return $out;
    }
}
