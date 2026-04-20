import { Inbox } from "lucide-react";

export function EmptyState({
  title = "No items yet",
  description = "Once ingestion runs, items will appear here in real time.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
        <Inbox className="h-4 w-4" />
      </span>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="max-w-sm text-sm text-muted-fg leading-relaxed">{description}</p>
    </div>
  );
}
