export function SetupBanner() {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm">
      <h2 className="font-semibold text-fg mb-2">Finish setup to start seeing the feed</h2>
      <ol className="list-decimal space-y-2 pl-5 text-muted-fg">
        <li>
          Create a Supabase project, then run{" "}
          <code className="rounded bg-muted px-1 font-mono text-xs">supabase/migrations/001_init.sql</code>{" "}
          and{" "}
          <code className="rounded bg-muted px-1 font-mono text-xs">supabase/seed/sources.sql</code>{" "}
          in the SQL editor.
        </li>
        <li>
          Copy <code className="rounded bg-muted px-1 font-mono text-xs">.env.example</code> →{" "}
          <code className="rounded bg-muted px-1 font-mono text-xs">.env.local</code> and fill in
          Supabase + Anthropic keys.
        </li>
        <li>Restart the dev server.</li>
        <li>
          Trigger ingestion manually once (coming in Phase 2) — the cron endpoint will appear at{" "}
          <code className="rounded bg-muted px-1 font-mono text-xs">/api/cron/poll</code>.
        </li>
      </ol>
    </div>
  );
}
