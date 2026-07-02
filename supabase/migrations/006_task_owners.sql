-- Bug 1: multi-owner support for task_drafts.
-- Run in Supabase SQL Editor: https://app.supabase.com/project/mumtecnnwphdslvghocb/sql
-- Backward compatible: existing single-owner drafts keep their `owner` string;
-- new `owners` array defaults to '{}'.

ALTER TABLE task_drafts
  ADD COLUMN IF NOT EXISTS owners text[] DEFAULT '{}';
