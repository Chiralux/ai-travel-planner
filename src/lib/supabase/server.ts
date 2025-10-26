import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { loadEnv } from "../../core/config/env";
import type { Database } from "./types";

export type ServerSupabaseClient = SupabaseClient<Database>;

let serviceRoleClient: ServerSupabaseClient | null = null;

function requireEnv(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }

  return value;
}

export function getSupabaseServiceRoleClient(): ServerSupabaseClient {
  if (serviceRoleClient) {
    return serviceRoleClient;
  }

  const env = loadEnv();
  const url = requireEnv(env.SUPABASE_URL, "SUPABASE_URL");
  const serviceKey = requireEnv(env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");

  serviceRoleClient = createClient<Database>(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return serviceRoleClient;
}

export function createSupabaseServerClient(accessToken?: string | null): ServerSupabaseClient {
  const env = loadEnv();
  const url = requireEnv(env.SUPABASE_URL, "SUPABASE_URL");
  const anonKey = requireEnv(env.SUPABASE_ANON_KEY, "SUPABASE_ANON_KEY");

  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
    }
  });
}

export async function getUserFromAccessToken(accessToken: string): Promise<User> {
  const client = createSupabaseServerClient(accessToken);
  const { data, error } = await client.auth.getUser(accessToken);

  if (error || !data.user) {
    throw new Error("Invalid or expired Supabase access token.");
  }

  return data.user;
}
