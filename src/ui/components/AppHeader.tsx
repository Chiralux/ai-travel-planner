"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useSupabaseAuth } from "../../lib/supabase/AuthProvider";

export function AppHeader() {
  const router = useRouter();
  const { user, loading, signOut } = useSupabaseAuth();
  const [signingOut, setSigningOut] = useState(false);

  const handleLogout = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.push("/auth");
    } finally {
      setSigningOut(false);
    }
  }, [signOut, router]);

  return (
    <header className="mb-6 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3 shadow">
      <Link href="/" className="text-lg font-semibold text-slate-100">
        AI Travel Planner
      </Link>

      <nav className="flex items-center gap-3 text-sm">
        <Link href="/planner" className="rounded-md border border-transparent px-3 py-1 text-slate-200 hover:border-blue-500 hover:text-blue-300">
          Planner
        </Link>
        {loading ? (
          <span className="text-slate-400">加载中...</span>
        ) : user ? (
          <div className="flex items-center gap-2">
            <span className="truncate text-slate-300" title={user.email ?? user.id}>
              {user.email ?? user.id}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              disabled={signingOut}
              className="rounded-md border border-slate-700 px-3 py-1 text-slate-200 transition hover:border-red-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {signingOut ? "退出中..." : "退出"}
            </button>
          </div>
        ) : (
          <Link
            href="/auth"
            className="rounded-md border border-blue-500 px-3 py-1 text-blue-300 hover:bg-blue-500/10"
          >
            登录 / 注册
          </Link>
        )}
      </nav>
    </header>
  );
}
