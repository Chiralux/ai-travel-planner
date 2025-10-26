"use client";

import type { ReactNode } from "react";
import { SupabaseAuthProvider } from "../lib/supabase/AuthProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return <SupabaseAuthProvider>{children}</SupabaseAuthProvider>;
}
