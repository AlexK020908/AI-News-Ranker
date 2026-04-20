import Link from "next/link";
import { Zap } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur">
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent text-accent-fg">
            <Zap className="h-3.5 w-3.5" />
          </span>
          <span>AI News Feed</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-fg">
          <Link href="/?sort=hot" className="hover:text-fg">Hot</Link>
          <Link href="/?sort=new" className="hover:text-fg">New</Link>
          <Link href="/about" className="hover:text-fg hidden sm:inline">About</Link>
        </nav>
      </div>
    </header>
  );
}
