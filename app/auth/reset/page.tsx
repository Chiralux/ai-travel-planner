"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSupabaseAuth } from "../../../src/lib/supabase/AuthProvider";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { session, loading, updateUserPassword } = useSupabaseAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !session) {
      setFeedback("重置链接已失效或尚未登录，请重新申请密码重置邮件。");
    }
  }, [loading, session]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!session) {
        setFeedback("会话已失效，请重新申请密码重置邮件。");
        return;
      }

      if (!newPassword || newPassword.length < 6) {
        setFeedback("新密码至少需要 6 位长度。");
        return;
      }

      if (newPassword !== confirmPassword) {
        setFeedback("两次输入的密码不一致。");
        return;
      }

      setSubmitting(true);
      setFeedback(null);
      try {
        const result = await updateUserPassword({ password: newPassword });
        if (result.error) {
          setFeedback(result.error.message ?? "更新密码失败，请稍后重试。");
          return;
        }

        setFeedback("密码已更新，请重新登录。");
        setTimeout(() => router.replace("/auth"), 600);
      } finally {
        setSubmitting(false);
      }
    },
    [confirmPassword, newPassword, router, session, updateUserPassword]
  );

  if (loading && !session) {
    return (
      <section className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-8 text-center text-slate-300">
        正在验证重置链接...
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-xl">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold text-white">重置密码</h1>
        <p className="text-sm text-slate-300">请设置一个新的登录密码。</p>
      </header>

      {!session ? (
        <p className="rounded-md border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
          重置链接可能已过期，请返回登录页重新发送重置邮件。
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="text-sm text-slate-200">
            新密码
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              placeholder="至少 6 位"
            />
          </label>

          <label className="text-sm text-slate-200">
            确认新密码
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
              placeholder="再次输入新密码"
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="rounded-md border border-blue-500 bg-blue-500/10 px-4 py-2 text-sm text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "更新中..." : "更新密码"}
          </button>
        </form>
      )}

      {feedback && <p className="text-sm text-amber-300">{feedback}</p>}
    </section>
  );
}
