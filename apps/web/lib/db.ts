import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@shared/supabase-types';

let client: SupabaseClient<Database> | null = null;

export function getDb(): SupabaseClient<Database> {
  if (!client) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error(
        'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables',
      );
    }

    client = createClient<Database>(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });
  }

  return client;
}

/** Lazy proxy — defers client creation until first use at request time. */
export const db: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
