"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/** True when the Supabase env vars exist (cloud mode). Otherwise the app runs
 *  in local mode: seeded data in localStorage, no sign-in. */
export const SUPABASE_READY =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    // With no credentials, createBrowserClient() throws and the whole app dies
    // at startup. Fall back to a loopback placeholder so session lookups simply
    // return "signed out" and every caller lands in local mode.
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "local-mode-anon-key"
    );
  }
  return client;
}
