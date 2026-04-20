import Link from "next/link";
import { Search, Zap } from "lucide-react";
import { SEARCH_MAX_LEN } from "@/lib/utils";

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/75 backdrop-blur-md">
      <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-4">
        <Link href="/" className="group flex items-center gap-2.5 shrink-0">
          <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary ring-1 ring-primary/30 transition-all group-hover:bg-primary/25 group-hover:ring-primary/60">
            <Zap className="h-3.5 w-3.5" />
            <span className="pointer-events-none absolute inset-0 rounded-md opacity-0 blur-md transition-opacity group-hover:opacity-60 bg-primary" aria-hidden />
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-semibold tracking-tight">AI News Feed</span>
            <span className="label-caps mt-1 text-muted-fg">frontier signal · live</span>
          </span>
        </Link>
        <SearchBox />
        <nav className="ml-auto flex items-center gap-1 text-sm">
          <NavLink href="/?sort=hot">Hot</NavLink>
          <NavLink href="/?sort=new">New</NavLink>
          <NavLink href="/about" className="hidden sm:inline-flex">About</NavLink>
        </nav>
      </div>
    </header>
  );
}

function SearchBox() {
  return (
    <form
      action="/search"
      method="GET"
      role="search"
      className="hidden sm:flex flex-1 min-w-0 max-w-xs items-center gap-2 rounded-md border border-border bg-card/60 px-2.5 py-1.5 ring-1 ring-transparent backdrop-blur-sm transition-colors focus-within:border-primary/50 focus-within:ring-primary/30"
    >
      <Search className="h-3.5 w-3.5 shrink-0 text-muted-fg" aria-hidden />
      <input
        type="search"
        name="q"
        placeholder="Search the feed…"
        maxLength={SEARCH_MAX_LEN}
        aria-label="Search"
        className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted-fg"
      />
    </form>
  );
}

function NavLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`label-caps rounded-md px-2.5 py-1.5 text-muted-fg transition-colors hover:bg-muted hover:text-fg ${className}`}
    >
      {children}
    </Link>
  );
}
