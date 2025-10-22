import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "AI Travel Planner",
  description: "Next.js 14 starter with Tailwind, Zustand, and more"
};

export default function RootLayout({
  children
}: {
  children: ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-slate-950 text-slate-100">
        <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-12">
          {children}
        </main>
      </body>
    </html>
  );
}
