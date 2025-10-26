import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/v135/@supabase/supabase-js@2.46.0?target=esnext";
import type { Database } from "../../src/lib/supabase/types.ts";

interface TripPayload {
  id: string;
  user_id: string;
  updated_at: string;
  changes: Record<string, unknown>;
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers ?? {})
    }
  });
}

function getRequiredEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  let payload: TripPayload | null = null;

  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload || !payload.id || !payload.user_id) {
    return jsonResponse({ ok: false, error: "Missing required fields" }, { status: 400 });
  }

  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const serviceKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient<Database>(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { error } = await supabase
    .from("trips")
    .update({ synced_at: new Date().toISOString(), updated_at: payload.updated_at })
    .eq("id", payload.id)
    .eq("user_id", payload.user_id);

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, { status: 500 });
  }

  // TODO: extend logic to push notifications or invalidate caches.

  return jsonResponse({ ok: true, data: { id: payload.id, synced: true } });
});
