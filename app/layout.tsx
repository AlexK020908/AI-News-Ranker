import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI News Feed — real-time curation of what matters in AI",
  description:
    "A single feed for frontier AI: new models, papers, GitHub releases, funding, and announcements — ranked by importance, summarized, and updated in real time.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body className="min-h-dvh flex flex-col bg-bg text-fg">
        <Header />
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {children}
        </main>
        <footer className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-10 label-caps text-muted-fg">
          Curated with Claude Haiku 4.5 · updated in real time
        </footer>
      </body>
    </html>
  );
}
