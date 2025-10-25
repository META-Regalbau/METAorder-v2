import ShippingInfoForm from '../ShippingInfoForm';

export default function ShippingInfoFormExample() {
  return (
    <div className="p-4 max-w-md">
      <ShippingInfoForm
        defaultValues={{
          carrier: "DHL",
          trackingNumber: "1234567890",
          shippedDate: "2024-01-15"
        }}
        onSubmit={(data) => console.log('Form submitted:', data)}
        onCancel={() => console.log('Form cancelled')}
      />
    </div>
  );
}
