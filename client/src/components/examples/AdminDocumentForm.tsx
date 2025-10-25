import AdminDocumentForm from '../AdminDocumentForm';

export default function AdminDocumentFormExample() {
  return (
    <div className="p-4 max-w-md">
      <AdminDocumentForm
        defaultValues={{
          invoiceNumber: "INV-2024-001",
          deliveryNoteNumber: "DN-2024-001",
          erpNumber: "ERP-12345"
        }}
        onSubmit={(data) => console.log('Form submitted:', data)}
        onCancel={() => console.log('Form cancelled')}
      />
    </div>
  );
}
