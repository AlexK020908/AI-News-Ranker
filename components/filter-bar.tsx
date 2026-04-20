import Link from "next/link";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface FilterBarProps {
  activeCategory?: Category | null;
  activeSort?: "hot" | "new";
  minImportance?: number;
}

export function FilterBar({
  activeCategory,
  activeSort = "new",
  minImportance = 0,
}: FilterBarProps) {
  const mkHref = (params: Record<string, string | undefined | null>) => {
    const current: Record<string, string> = { sort: activeSort };
    if (activeCategory) current.cat = activeCategory;
    if (minImportance) current.min = String(minImportance);
    const next = { ...current, ...params };
    const qp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v !== undefined && v !== null && v !== "") qp.set(k, String(v));
    }
    const qs = qp.toString();
    return qs ? `/?${qs}` : "/";
  };

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-lg border border-border bg-card/60 p-3 backdrop-blur-sm">
      <div className="flex flex-wrap gap-1.5">
        <Chip href={mkHref({ cat: null })} active={!activeCategory}>
          All
        </Chip>
        {CATEGORIES.map((c) => (
          <Chip key={c} href={mkHref({ cat: c })} active={activeCategory === c}>
            {CATEGORY_LABELS[c]}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 border-t border-border">
        <ToggleGroup label="Sort">
          <ToggleLink href={mkHref({ sort: "new" })} active={activeSort === "new"}>New</ToggleLink>
          <ToggleLink href={mkHref({ sort: "hot" })} active={activeSort === "hot"}>Hot</ToggleLink>
        </ToggleGroup>
        <ToggleGroup label="Min importance">
          {[0, 40, 60, 80, 90].map((n) => (
            <ToggleLink
              key={n}
              href={mkHref({ min: n ? String(n) : null })}
              active={minImportance === n}
            >
              <span className="font-mono tabular-nums">{n}</span>
            </ToggleLink>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}

function ToggleGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="label-caps text-muted-fg">{label}</span>
      <div className="flex items-center gap-0.5 rounded-md bg-bg/60 p-0.5 ring-1 ring-border">
        {children}
      </div>
    </div>
  );
}

function ToggleLink({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded px-2 py-0.5 text-xs transition-colors",
        active
          ? "bg-primary/20 text-primary ring-1 ring-primary/40"
          : "text-muted-fg hover:text-fg",
      )}
    >
      {children}
    </Link>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
        active
          ? "border-primary/50 bg-primary/15 text-primary shadow-[0_0_0_1px_rgba(167,139,250,0.25),0_6px_18px_-8px_rgba(167,139,250,0.4)]"
          : "border-border bg-bg/40 text-muted-fg hover:border-border-strong hover:text-fg",
      )}
    >
      {children}
    </Link>
  );
}
