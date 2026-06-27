-- Commercial Agent: Few-Shot-Lernexemplare aus erfolgreichen Läufen und Nutzer-Feedback
CREATE TABLE IF NOT EXISTS "commercial_agent_exemplars" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" varchar REFERENCES "tenants"("id"),
  "source_kind" text NOT NULL,
  "intent_label" text NOT NULL,
  "subject_excerpt" text,
  "email_excerpt" text,
  "pdf_excerpt" text,
  "signals_json" jsonb,
  "quality_score" integer DEFAULT 1 NOT NULL,
  "draft_kind" text,
  "reference_draft_id" varchar,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "commercial_agent_exemplars_tenant_created_idx"
  ON "commercial_agent_exemplars" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "commercial_agent_exemplars_tenant_quality_idx"
  ON "commercial_agent_exemplars" ("tenant_id", "quality_score" DESC);
