-- Add deposit_percent column to installment_plans
ALTER TABLE installment_plans
  ADD COLUMN IF NOT EXISTS deposit_percent DECIMAL(5,2);
