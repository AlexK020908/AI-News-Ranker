import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetbrains = JetBrains_Mono({
  variable: "--font-mono-google",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "StackBrief — the only newsletter to keep up with AI",
  description:
    "Daily AI briefing across papers, models, repos, and news. Clustered across sources so you read each story once.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={jetbrains.variable} data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
