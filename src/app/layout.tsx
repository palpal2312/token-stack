import type { Metadata } from "next";
import "./globals.css";
import Shell from "@/components/Shell";

export const metadata: Metadata = {
  title: "NEWS OS",
  description: "Everything at once for local agent orchestration.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/news-os-icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/news-os-icon.png", sizes: "512x512", type: "image/png" }],
  },
};

// The dashboard pages render live local state, so they must never be baked
// into prerendered HTML.
export const dynamic = "force-dynamic";

// Auth bootstrap lives in src/proxy.ts: it sets the HttpOnly
// agentic_os_session cookie on every page navigation. The API token is never
// exposed to JavaScript — no window global, no query param — and same-origin
// fetch / EventSource / WebSocket carry the cookie automatically.
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        {/*
          Midnight Aubergine design system — three voices:
          Bricolage Grotesque (display) · Manrope (body) · Caveat (hand-script
          numerals/emphasis) · JetBrains Mono (code).
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..800&family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&family=Caveat:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-full">
        <div className="relative z-10">
          <Shell>{children}</Shell>
        </div>
      </body>
    </html>
  );
}
