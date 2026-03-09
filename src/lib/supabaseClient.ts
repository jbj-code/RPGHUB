import { createClient } from "@supabase/supabase-js";

// Vite exposes env vars prefixed with VITE_
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // This will surface a clear error in the browser console during development
  console.error(
    "[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env variables."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

