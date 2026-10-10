import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// Only the PUBLIC (anon / publishable) key is ever used in the browser.
// Never put the service-role key in this project.
const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined;

export const isSupabaseConfigured = Boolean(url && key);

// Placeholders keep the app from crashing at import time when env vars are
// missing; <AuthGate /> shows a clear setup message in that case.
export const supabase = createClient<Database>(
  url || "https://placeholder.supabase.co",
  key || "placeholder-anon-key",
  {
    auth: {
      // The app is server-rendered, so only touch localStorage in the browser.
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
