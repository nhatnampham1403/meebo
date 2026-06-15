-- Add external_party column to task_drafts if not already present.
-- Run this in Supabase SQL Editor: https://app.supabase.com/project/mumtecnnwphdslvghocb/sql
ALTER TABLE task_drafts ADD COLUMN IF NOT EXISTS external_party text;
