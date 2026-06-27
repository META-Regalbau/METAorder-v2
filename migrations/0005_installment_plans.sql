-- Teilzahlungspläne und Teilrechnungen (METAorder, pro Shopware-Order)
CREATE TABLE IF NOT EXISTS "installment_plans" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" varchar REFERENCES "tenants"("id"),
  "order_id" text NOT NULL,
  "order_number" text NOT NULL,
  "customer_name" text NOT NULL,
  "customer_email" text,
  "total_amount" numeric(12, 2) NOT NULL,
  "deposit_amount" numeric(12, 2) NOT NULL,
  "deposit_invoice_number" text,
  "remaining_amount" numeric(12, 2) NOT NULL,
  "number_of_installments" integer NOT NULL,
  "installment_amount" numeric(12, 2) NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "agreement_pdf_path" text,
  "agreement_confirmed_at" timestamp,
  "agreement_confirmed_by" text,
  "created_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "installment_plans_tenant_order_idx"
  ON "installment_plans" ("tenant_id", "order_id");

CREATE TABLE IF NOT EXISTS "installment_invoices" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" varchar REFERENCES "tenants"("id"),
  "installment_plan_id" varchar NOT NULL REFERENCES "installment_plans"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "sequence_number" integer NOT NULL,
  "invoice_number" text,
  "amount" numeric(12, 2) NOT NULL,
  "due_date" timestamp,
  "status" text DEFAULT 'pending' NOT NULL,
  "paid_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "installment_invoices_plan_seq_idx"
  ON "installment_invoices" ("installment_plan_id", "sequence_number");
