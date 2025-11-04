import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

let browserClient: SupabaseClient<Database, "public"> | null = null;

function resolveBrowserCredentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

  if (!url || !anonKey) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[supabase] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    }

    return { url: "", anonKey: "" };
  }

  return { url, anonKey };
}

export function createSupabaseBrowserClient(): SupabaseClient<Database, "public"> {
  const { url, anonKey } = resolveBrowserCredentials();

  if (!url || !anonKey) {
    throw new Error("Supabase browser credentials are missing. Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.");
  }

  return createClient<Database, "public">(url, anonKey, {
    auth: {
      persistSession: true,
      detectSessionInUrl: true
    }
  });
}

export function getSupabaseBrowserClient(): SupabaseClient<Database, "public"> {
  if (!browserClient) {
    browserClient = createSupabaseBrowserClient();
  }

  return browserClient;
}
