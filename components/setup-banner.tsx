import { AlertTriangle } from "lucide-react";

export function SetupBanner() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-warn/25 bg-warn/[0.04] p-5 text-sm">
      <span
        className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-warn/10 blur-3xl"
        aria-hidden
      />
      <div className="relative flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-warn/15 text-warn ring-1 ring-warn/30">
          <AlertTriangle className="h-3.5 w-3.5" />
        </span>
        <div className="flex-1 space-y-3">
          <div>
            <h2 className="label-caps text-warn">Setup required</h2>
            <p className="mt-1 font-semibold text-fg">Finish setup to start seeing the feed</p>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-muted-fg">
            <li>
              Create a Supabase project, then run <Code>supabase/migrations/001_init.sql</Code>{" "}
              and <Code>supabase/seed/sources.sql</Code> in the SQL editor.
            </li>
            <li>
              Copy <Code>.env.example</Code> → <Code>.env.local</Code> and fill in Supabase +
              Anthropic keys (and <Code>CRON_SECRET</Code>).
            </li>
            <li>Restart the dev server.</li>
            <li>
              Trigger ingestion manually:{" "}
              <Code>
                curl -H &quot;Authorization: Bearer $CRON_SECRET&quot; localhost:3000/api/cron/ingest
              </Code>
              , then <Code>/api/cron/enrich</Code>.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-fg ring-1 ring-border">
      {children}
    </code>
  );
}
