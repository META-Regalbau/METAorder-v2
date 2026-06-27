-- Öffentliche Angebots-Links (Token-Hash) für Kunden-Landingpage und Annahme
CREATE TABLE IF NOT EXISTS "offer_public_links" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" varchar REFERENCES "tenants"("id"),
  "shopware_offer_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "created_by_user_id" varchar REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_access_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "offer_public_links_token_hash_idx"
  ON "offer_public_links" ("token_hash");

CREATE INDEX IF NOT EXISTS "offer_public_links_tenant_offer_idx"
  ON "offer_public_links" ("tenant_id", "shopware_offer_id");

-- Audit: Zugriffe / Annahme / Ablehnung
CREATE TABLE IF NOT EXISTS "offer_public_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "link_id" varchar NOT NULL REFERENCES "offer_public_links"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "ip" text,
  "meta" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "offer_public_events_link_idx"
  ON "offer_public_events" ("link_id");
