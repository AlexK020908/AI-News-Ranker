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
    const current: Record<string, string> = {
      sort: activeSort,
    };
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
    <div className="flex flex-col gap-3 border-b border-border pb-4 mb-4">
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

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-fg">
        <div className="flex items-center gap-1">
          <span className="opacity-70">Sort:</span>
          <Link
            href={mkHref({ sort: "new" })}
            className={cn("rounded px-1.5 py-0.5", activeSort === "new" && "bg-muted text-fg")}
          >
            New
          </Link>
          <Link
            href={mkHref({ sort: "hot" })}
            className={cn("rounded px-1.5 py-0.5", activeSort === "hot" && "bg-muted text-fg")}
          >
            Hot
          </Link>
        </div>
        <div className="flex items-center gap-1">
          <span className="opacity-70">Min importance:</span>
          {[0, 40, 60, 80, 90].map((n) => (
            <Link
              key={n}
              href={mkHref({ min: n ? String(n) : null })}
              className={cn(
                "rounded px-1.5 py-0.5 font-mono tabular-nums",
                minImportance === n && "bg-muted text-fg",
              )}
            >
              {n}
            </Link>
          ))}
        </div>
      </div>
    </div>
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
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-fg bg-fg text-bg"
          : "border-border text-muted-fg hover:text-fg",
      )}
    >
      {children}
    </Link>
  );
}
