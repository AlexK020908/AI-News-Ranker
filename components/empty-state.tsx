import { Inbox } from "lucide-react";

export function EmptyState({
  title = "No items yet",
  description = "Once ingestion runs, items will appear here in real time.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
      <Inbox className="h-8 w-8 text-muted-fg" />
      <h2 className="text-base font-medium">{title}</h2>
      <p className="max-w-sm text-sm text-muted-fg">{description}</p>
    </div>
  );
}
