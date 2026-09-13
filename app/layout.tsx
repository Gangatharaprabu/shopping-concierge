import type { Metadata } from "next";
import "./globals.css";
import ChatBar from "./components/ChatBar";

export const metadata: Metadata = {
  title: "Shopping Concierge",
  description: "AI shopping concierge -- describe a need, get a shopping list.",
};

/**
 * Root layout -- mobile-first (`max-w-md`), Outfit throughout (see
 * globals.css's `@import`/`@theme`), and the persistent bottom `<ChatBar>`
 * from this phase's redesign brief, mounted once here so it's present on
 * every route.
 *
 * The previous phase's site-wide `<header>`/nav bar (logo + "Browse" link +
 * signed-in email) is dropped: the Figma reference's screens each own their
 * own header (see HomeFeed/DetailView/CartView in the reference), and
 * stacking a second, generic nav bar above a persistent bottom chat bar
 * would fight the mobile-first, single-column visual language this redesign
 * is porting -- every route here now renders its own header treatment
 * instead (see app/page.tsx, app/usecases/[id]/page.tsx, etc.). The
 * anonymous-auth display-only hook this header used to have (getNavUserEmail)
 * is dropped along with it; nothing else depended on it.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex justify-center bg-zinc-100">
        <div className="flex min-h-dvh w-full max-w-md flex-col bg-white" style={{ fontFamily: "var(--font-sans)" }}>
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
          <ChatBar />
        </div>
      </body>
    </html>
  );
}
