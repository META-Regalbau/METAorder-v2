-- Migration: Portal-Neuigkeiten
-- Date: 2026-10-21
-- Description:
--   portal_news_posts: Beiträge für die Neuigkeiten-Seite im Portal, aus Changelog-Mails (über n8n)
--   oder von Hand eingefügt; METAorder schreibt die veröffentlichten auf eine Erlebniswelt. Idempotent.

CREATE TABLE IF NOT EXISTS portal_news_posts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  message_id TEXT NOT NULL,
  graph_message_id TEXT,
  mailbox TEXT,
  subject TEXT NOT NULL DEFAULT '',
  from_email TEXT,
  from_name TEXT,
  received_at TIMESTAMP NOT NULL DEFAULT now(),
  body_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  post_date DATE NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_news_posts_tenant_message_idx
  ON portal_news_posts (tenant_id, message_id);
CREATE INDEX IF NOT EXISTS portal_news_posts_tenant_status_idx
  ON portal_news_posts (tenant_id, status, post_date);
