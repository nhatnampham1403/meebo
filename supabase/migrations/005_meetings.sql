-- Phase 6: meetings capture + task_drafts linkage
-- Run in Supabase SQL Editor: https://app.supabase.com/project/mumtecnnwphdslvghocb/sql

CREATE TABLE IF NOT EXISTS meetings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  source_type     text NOT NULL CHECK (source_type IN ('sprint_meeting', 'customer_meeting')),
  source_channel  text NOT NULL DEFAULT 'web' CHECK (source_channel IN ('web', 'telegram')),
  raw_transcript  text NOT NULL,
  summary         text,
  participants    text[]
);

ALTER TABLE task_drafts
  ADD COLUMN IF NOT EXISTS meeting_id uuid REFERENCES meetings(id),
  ADD COLUMN IF NOT EXISTS source_channel text DEFAULT 'web';

CREATE INDEX IF NOT EXISTS idx_task_drafts_meeting_id ON task_drafts(meeting_id);
