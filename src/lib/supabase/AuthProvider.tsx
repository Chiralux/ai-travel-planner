"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import type { ReactNode } from "react";
import type {
  AuthError,
  AuthResponse,
  OAuthResponse,
  Provider,
  Session,
  SupabaseClient
} from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "./client";
import type { Database } from "./types";

type AuthContextValue = {
  supabase: SupabaseClient<Database>;
  session: Session | null;
  user: Session["user"] | null;
  accessToken: string | null;
  loading: boolean;
  authError: AuthError | null;
  signInWithOAuth: (provider: Provider, options?: { redirectTo?: string }) => Promise<OAuthResponse>;
  signInWithPassword: (params: { email: string; password: string }) => Promise<AuthResponse>;
  signUpWithPassword: (params: { email: string; password: string }) => Promise<AuthResponse>;
  resetPasswordForEmail: (params: { email: string; redirectTo?: string }) => ReturnType<SupabaseClient<Database>["auth"]["resetPasswordForEmail"]>;
  updateUserPassword: (params: { password: string }) => ReturnType<SupabaseClient<Database>["auth"]["updateUser"]>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<AuthError | null>(null);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (!isMounted) {
          return;
        }

        setSession(data.session);
        setAuthError(error ?? null);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) {
        return;
      }

      setSession(nextSession);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const signInWithOAuth = useCallback<AuthContextValue["signInWithOAuth"]>(
    async (provider, options) => {
      setAuthError(null);
      const result = await supabase.auth.signInWithOAuth({ provider, options });
      if (result.error) {
        setAuthError(result.error);
      }
      return result;
    },
    [supabase]
  );

  const signInWithPassword = useCallback<AuthContextValue["signInWithPassword"]>(
    async ({ email, password }) => {
      setAuthError(null);
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) {
        setAuthError(result.error);
      }
      return result;
    },
    [supabase]
  );

  const signUpWithPassword = useCallback<AuthContextValue["signUpWithPassword"]>(
    async ({ email, password }) => {
      setAuthError(null);
      const result = await supabase.auth.signUp({ email, password });
      if (result.error) {
        setAuthError(result.error);
      }
      return result;
    },
    [supabase]
  );

  const resetPasswordForEmail = useCallback<AuthContextValue["resetPasswordForEmail"]>(
    async ({ email, redirectTo }) => {
      setAuthError(null);
      const options = redirectTo ? { redirectTo } : undefined;
      const result = await supabase.auth.resetPasswordForEmail(email, options);
      if (result.error) {
        setAuthError(result.error);
      }
      return result;
    },
    [supabase]
  );

  const updateUserPassword = useCallback<AuthContextValue["updateUserPassword"]>(
    async ({ password }) => {
      setAuthError(null);
      const result = await supabase.auth.updateUser({ password });
      if (result.error) {
        setAuthError(result.error);
      }
      return result;
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    setAuthError(null);

    const { data } = await supabase.auth.getSession();
    const hasSession = Boolean(data.session);

    const attempt = hasSession ? await supabase.auth.signOut() : { error: null };

    const shouldFallback = Boolean(attempt.error);

    let finalError = attempt.error;

    if (shouldFallback) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[supabase] Global sign-out failed, retrying with local scope", attempt.error?.message);
      }

      const fallback = await supabase.auth.signOut({ scope: "local" });
      finalError = fallback.error ?? attempt.error;
    } else if (!hasSession) {
      // Ensure local tokens are cleared even if the server no longer recognises the session.
      await supabase.auth.signOut({ scope: "local" });
    }

    if (finalError && finalError.message !== "Auth session missing!") {
      setAuthError(finalError);
      return;
    }

    setSession(null);
  }, [supabase]);

  const value = useMemo<AuthContextValue>(
    () => ({
      supabase,
      session,
      user: session?.user ?? null,
      accessToken: session?.access_token ?? null,
      loading,
      authError,
      signInWithOAuth,
      signInWithPassword,
      signUpWithPassword,
      resetPasswordForEmail,
      updateUserPassword,
      signOut
    }),
    [
      supabase,
      session,
      loading,
      authError,
      signInWithOAuth,
      signInWithPassword,
      signUpWithPassword,
      resetPasswordForEmail,
      updateUserPassword,
      signOut
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useSupabaseAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useSupabaseAuth must be used within SupabaseAuthProvider");
  }
  return ctx;
}
