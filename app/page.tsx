import Link from "next/link";

export default function HomePage() {
  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-lg">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-white">AI Travel Planner</h1>
        <p className="text-slate-300">
          Next.js 14 + Tailwind CSS + Zustand + tRPC + Logtail + Redis starter. Edit this
          page in <code className="rounded bg-slate-800 px-1">app/page.tsx</code> and
          save to preview changes.
        </p>
      </header>

      <div className="space-y-3 text-slate-200">
        <p>
          - 状态管理示例位于 <code className="rounded bg-slate-800 px-1">lib/store/useUiStore.ts</code>
        </p>
        <p>
          - Tailwind 样式入口在 <code className="rounded bg-slate-800 px-1">styles/globals.css</code>
        </p>
        <p>
          - tRPC、Redis、Logtail 的配置由你在后续步骤中扩展。
        </p>
      </div>

      <footer className="pt-2 text-sm text-slate-400">
        <Link className="underline decoration-dashed" href="https://nextjs.org/docs/app">
          Next.js App Router 文档
        </Link>
      </footer>
    </section>
  );
}
