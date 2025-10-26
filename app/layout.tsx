import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../styles/globals.css";
import { AppProviders } from "../src/app/providers";
import { AppHeader } from "../src/ui/components/AppHeader";

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
        <AppProviders>
          <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6 py-8">
            <AppHeader />
            <main className="flex-1 pb-12">{children}</main>
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
