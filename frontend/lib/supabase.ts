import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error("Missing env variable: NEXT_PUBLIC_SUPABASE_URL");
}

if (!supabaseAnonKey) {
  throw new Error("Missing env variable: NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

// Temporary debug logging (safe, only in development)
if (process.env.NODE_ENV === "development") {
  console.log("[Supabase Config] URL configured:", !!supabaseUrl);
  console.log("[Supabase Config] Anon Key configured:", !!supabaseAnonKey);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

