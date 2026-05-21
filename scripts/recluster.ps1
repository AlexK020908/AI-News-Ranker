# Triggers cluster-topics once. Useful after enrich changes or when debugging
# clustering without waiting for the next loop tick.
# Usage:  powershell -ExecutionPolicy Bypass -File .\scripts\recluster.ps1

$ErrorActionPreference = "Continue"

$envFile = Join-Path $PSScriptRoot "..\.env.local"
$secret = (Get-Content $envFile | Where-Object { $_ -match '^CRON_SECRET=' }) -replace '^CRON_SECRET=', ''
if (-not $secret) { throw "CRON_SECRET not found in .env.local" }

$headers = @{ Authorization = "Bearer $secret" }

Write-Host "Clustering..."
try {
  $r = Invoke-RestMethod -Uri "http://localhost:3000/api/jobs/cluster-topics" -Headers $headers -TimeoutSec 600
  Write-Host ("items={0} clusters={1} labeled={2} reused={3} skipped={4}" -f `
    $r.items, $r.clusters, $r.labeled, $r.reused, $r.skipped)
} catch {
  Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Yellow
  if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
  exit 1
}

Write-Host "`nDone. Refresh localhost:3000."
