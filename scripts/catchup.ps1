# One-shot: burns through the enrichment backlog and triggers clustering.
# Usage:  powershell -ExecutionPolicy Bypass -File .\scripts\catchup.ps1

$ErrorActionPreference = "Continue"

$envFile = Join-Path $PSScriptRoot "..\.env.local"
$secret = (Get-Content $envFile | Where-Object { $_ -match '^CRON_SECRET=' }) -replace '^CRON_SECRET=', ''
if (-not $secret) { throw "CRON_SECRET not found in .env.local" }

$base = "http://localhost:3000"
$headers = @{ Authorization = "Bearer $secret" }

function Hit($path, $timeout = 600) {
  try {
    return Invoke-RestMethod -Uri "$base$path" -Headers $headers -TimeoutSec $timeout
  } catch {
    Write-Host "  ! $path failed: $($_.Exception.Message)" -ForegroundColor Yellow
    return $null
  }
}

$rounds = 15
Write-Host "Running enrich x$rounds at limit=100..."
for ($i = 0; $i -lt $rounds; $i++) {
  $r = Hit "/api/jobs/enrich?limit=100"
  if ($r) {
    Write-Host ("round {0}: enriched={1} failed={2}" -f ($i + 1), $r.enriched, $r.failed)
    if ($r.enriched -eq 0 -and $r.failed -eq 0) {
      Write-Host "Backlog clear. Stopping early."
      break
    }
  }
}

Write-Host "`nClustering..."
$c = Hit "/api/jobs/cluster-topics"
if ($c) {
  Write-Host ("items={0} clusters={1} labeled={2} reused={3}" -f $c.items, $c.clusters, $c.labeled, $c.reused)
}

Write-Host "`nDone. Refresh localhost:3000."
