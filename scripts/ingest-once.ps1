# One-shot ingest trigger. Useful after fixing a source config to confirm the
# error clears, without waiting for the next loop tick.
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\scripts\ingest-once.ps1
#
# Requires:
#   - Dev server running (npm run dev) OR Docker app container reachable
#   - CRON_SECRET set in .env.local

$ErrorActionPreference = "Continue"

$envFile = Join-Path $PSScriptRoot "..\.env.local"
$secret = (Get-Content $envFile | Where-Object { $_ -match '^CRON_SECRET=' }) -replace '^CRON_SECRET=', ''
if (-not $secret) { throw "CRON_SECRET not found in .env.local" }

$base    = "http://localhost:3000"
$headers = @{ Authorization = "Bearer $secret" }

Write-Host "Hitting /api/jobs/ingest..." -ForegroundColor Cyan
try {
  $r = Invoke-RestMethod -Uri "$base/api/jobs/ingest" -Headers $headers -TimeoutSec 300
  Write-Host ("  sources={0} attempted={1} inserted={2} skipped={3} errored={4} pruned={5}" -f `
    $r.summary.sources, $r.summary.attempted, $r.summary.inserted, `
    $r.summary.skipped, $r.summary.errored, $r.summary.pruned) -ForegroundColor Green

  $errored = $r.results | Where-Object { $_.error }
  if ($errored) {
    Write-Host "`nSources with errors:" -ForegroundColor Yellow
    foreach ($e in $errored) {
      Write-Host ("  {0,-32} {1}" -f $e.sourceSlug, $e.error)
    }
  } else {
    Write-Host "`nAll enabled sources ingested cleanly." -ForegroundColor Green
  }
} catch {
  Write-Host "  ! failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
