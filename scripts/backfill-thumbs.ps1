# Repeatedly calls the enrich job in backfill_thumbs mode until no rows are
# updated. Each round resolves a fresh batch of enriched items whose
# s3_storage_id is null, deriving the thumbnail URL from GitHub OG (for repo
# rows) or by scraping og:image from the publisher's page.
#
# Usage:
#   $env:JOB_TOKEN   = "<token>"
#   $env:APP_BASE_URL = "http://localhost:3000"   # optional, defaults to localhost
#   .\scripts\backfill-thumbs.ps1
#
# Optional flags:
#   -BatchSize <int>   how many rows per round (default 50, max 100)
#   -MaxRounds <int>   safety cap (default 50)
param(
  [string]$BaseUrl  = $env:APP_BASE_URL,
  [string]$Token    = $env:JOB_TOKEN,
  [int]   $BatchSize = 50,
  [int]   $MaxRounds = 50
)

if (-not $BaseUrl) { $BaseUrl = "http://localhost:3000" }
if (-not $Token) {
  Write-Error "Set `$env:JOB_TOKEN or pass -Token <token>"
  exit 1
}

$uri     = "$BaseUrl/api/jobs/enrich?backfill_thumbs=1&limit=$BatchSize"
$headers = @{ Authorization = "Bearer $Token" }
$total   = 0
$rounds  = 0

for ($i = 1; $i -le $MaxRounds; $i++) {
  $rounds = $i
  try {
    $resp = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get -TimeoutSec 600
  } catch {
    Write-Error "Round $i failed: $($_.Exception.Message)"
    exit 1
  }
  Write-Host ("[round {0}] batch={1} updated={2} skipped={3}" -f $i, $resp.batch, $resp.updated, $resp.skipped)
  $total += [int]$resp.updated
  if ([int]$resp.batch -eq 0 -or [int]$resp.updated -eq 0) { break }
}

Write-Host ""
Write-Host ("done -- {0} rows updated across {1} round(s)" -f $total, $rounds)
