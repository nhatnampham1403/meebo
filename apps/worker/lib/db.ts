import { createClient } from '@supabase/supabase-js';
import type { Database } from '@shared';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

export const db = createClient<Database>(url, key, {
  auth: { persistSession: false },
});

export type DB = typeof db;
