import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Shopping Concierge",
  description: "AI shopping concierge -- describe a need, get a shopping list.",
};

/**
 * Best-effort "who's signed in" check for the nav bar only -- never throws
 * and never blocks rendering. middleware.ts silently establishes an
 * anonymous session for every visitor (no email), so this resolves to
 * `null` for the common case; it only returns a value for a real
 * (non-anonymous) account, which nothing in this app currently creates --
 * kept as a display-only hook for a possible future real-login feature.
 */
async function getNavUserEmail(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const email = await getNavUserEmail();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              Shopping Concierge
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <Link href="/" className="text-zinc-600 hover:text-zinc-900">
                Browse
              </Link>
              {email && <span className="text-zinc-600">{email}</span>}
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
