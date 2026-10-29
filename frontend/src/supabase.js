import { createClient } from '@supabase/supabase-js';

// Supabase project URL and publishable key are public client configuration; never put a service-role key here.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://acppowzflfldjqarovzu.supabase.co';
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_mb1teflEfSt5fmknmJ22RA_J9MADwiE';

export const supabase = createClient(supabaseUrl, publishableKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
