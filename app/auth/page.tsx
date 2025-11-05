"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSupabaseAuth } from "../../src/lib/supabase/AuthProvider";

const oauthProviders = [
  { key: "github", label: "使用 GitHub 登录" },
  { key: "google", label: "使用 Google 登录" }
] as const;

export default function AuthPage() {
  const router = useRouter();
  const {
    session,
    loading,
    authError,
    signInWithOAuth,
    signInWithPassword,
    signUpWithPassword,
    resetPasswordForEmail
  } = useSupabaseAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!loading && session) {
      router.replace("/planner");
    }
  }, [loading, session, router]);

  const handlePasswordSignIn = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!email || !password) {
        setFeedback("请输入邮箱与密码。");
        return;
      }

      setSubmitting(true);
      setFeedback(null);
      try {
        const result =
          mode === "sign-in"
            ? await signInWithPassword({ email, password })
            : await signUpWithPassword({ email, password });
        if (result.error) {
          const message = result.error.message ?? "";
          const normalized = message.toLowerCase();
          if (
            mode === "sign-up" &&
            (normalized.includes("already registered") || normalized.includes("already exists") || normalized.includes("already in use"))
          ) {
            setFeedback("该邮箱已注册，请直接使用邮箱密码登录。");
            setMode("sign-in");
          } else {
            setFeedback(message || (mode === "sign-in" ? "登录失败，请稍后重试。" : "注册失败，请稍后重试。"));
          }
        } else {
          if (mode === "sign-in") {
            setFeedback("登录成功，正在跳转...");
            setTimeout(() => router.replace("/planner"), 400);
          } else {
            const sessionResult = result.data?.session;
            const user = result.data?.user;
            const identities = user?.identities ?? [];

            if (!sessionResult && user && identities.length === 0) {
              setFeedback("该邮箱已注册，请直接使用邮箱密码登录或尝试重置密码。");
              setMode("sign-in");
            } else if (sessionResult) {
              setFeedback("注册成功，正在跳转...");
              setTimeout(() => router.replace("/planner"), 400);
            } else {
              setFeedback("注册成功，请查收验证邮件后使用邮箱密码登录。");
            }
          }
        }
      } finally {
        setSubmitting(false);
      }
    },
    [email, password, router, signInWithPassword, signUpWithPassword, mode]
  );

  const handleOAuth = useCallback(
    async (provider: (typeof oauthProviders)[number]["key"]) => {
      try {
        setFeedback(null);
        await signInWithOAuth(provider);
      } catch (error) {
        console.error("OAuth sign-in failed", error);
        setFeedback("OAuth 登录失败，请稍后再试。");
      }
    },
    [signInWithOAuth]
  );

  const handlePasswordReset = useCallback(async () => {
    if (!email) {
      setFeedback("请输入注册时使用的邮箱后再尝试发送重置邮件。");
      return;
    }

    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth/reset` : undefined;

    setResetting(true);
    setFeedback(null);
    try {
      const result = await resetPasswordForEmail({ email, redirectTo });
      if (result.error) {
        setFeedback(result.error.message ?? "重置邮件发送失败，请稍后重试。");
      } else {
        setFeedback("重置邮件已发送，请检查邮箱并按照指引完成密码重置。");
      }
    } finally {
      setResetting(false);
    }
  }, [email, resetPasswordForEmail]);

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-xl">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold text-white">登录 / 注册</h1>
        <p className="text-sm text-slate-300">请使用 OAuth 或邮箱密码{mode === "sign-in" ? "登录" : "注册"}以同步行程。</p>
      </header>

      <div className="flex flex-col gap-3">
        {oauthProviders.map((provider) => (
          <button
            key={provider.key}
            type="button"
            onClick={() => handleOAuth(provider.key)}
            className="rounded-lg border border-slate-700 bg-slate-950/80 px-4 py-2 text-slate-100 transition hover:border-blue-500 hover:text-blue-300"
          >
            {provider.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
        <span className="flex-1 border-t border-slate-700" />
        <span>或者</span>
        <span className="flex-1 border-t border-slate-700" />
      </div>

      <form onSubmit={handlePasswordSignIn} className="flex flex-col gap-3">
        <label className="text-sm text-slate-200">
          邮箱
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            placeholder="you@example.com"
          />
        </label>
        <label className="text-sm text-slate-200">
          密码
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            placeholder="至少 6 位"
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md border border-blue-500 bg-blue-500/10 px-4 py-2 text-sm text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (mode === "sign-in" ? "登录中..." : "注册中...") : mode === "sign-in" ? "邮箱密码登录" : "邮箱密码注册"}
        </button>
        {mode === "sign-in" && (
          <button
            type="button"
            onClick={handlePasswordReset}
            disabled={resetting}
            className="text-left text-sm text-slate-400 underline-offset-4 hover:text-blue-300 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resetting ? "发送重置邮件中..." : "忘记密码？发送重置邮件"}
          </button>
        )}
      </form>

      <p className="text-sm text-slate-300">
        {mode === "sign-in" ? "还没有账号？" : "已经注册过？"}
        <button
          type="button"
          onClick={() => {
            setFeedback(null);
            setMode((prev) => (prev === "sign-in" ? "sign-up" : "sign-in"));
          }}
          className="ml-2 text-sm font-medium text-blue-300 hover:text-blue-200"
        >
          {mode === "sign-in" ? "改为注册" : "改为登录"}
        </button>
      </p>

      {feedback && <p className="text-sm text-amber-300">{feedback}</p>}
      {authError && <p className="text-sm text-red-400">{authError.message}</p>}

      {loading && !session && <p className="text-center text-sm text-slate-400">正在检测登录状态...</p>}
      {!loading && session && <p className="text-center text-sm text-emerald-400">已登录，正在跳转...</p>}
    </section>
  );
}
