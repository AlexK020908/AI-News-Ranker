# Repeatedly calls the enrich job in backfill_thumbs mode until the queue is
# drained. Each round resolves a fresh batch of enriched items whose
# s3_storage_id is null, deriving the thumbnail URL from GitHub OG (for repo
# rows) or by scraping og:image from the publisher's page.
#
# Behavior:
#   - Stops when batch=0 (no more candidate rows in the DB).
#   - When a round produces updates=0 but batch>0, the candidates are all
#     transient (rate-limited / 5xx / network blip). Sleeps before retrying
#     so the limit window resets.
#   - Tracks consecutive empty-update rounds and gives up after a few.
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\scripts\backfill-thumbs.ps1

param(
  [string]$BaseUrl       = "http://localhost:3000",
  [int]   $BatchSize     = 50,
  [int]   $MaxRounds     = 200,
  [int]   $StallSleepSec = 30,
  [int]   $MaxStallRounds = 6
)

$ErrorActionPreference = "Continue"

$envFile = Join-Path $PSScriptRoot "..\.env.local"
$secret  = (Get-Content $envFile | Where-Object { $_ -match '^CRON_SECRET=' }) -replace '^CRON_SECRET=', ''
if (-not $secret) { throw "CRON_SECRET not found in .env.local" }

$uri     = "$BaseUrl/api/jobs/enrich?backfill_thumbs=1&limit=$BatchSize"
$headers = @{ Authorization = "Bearer $secret" }
$total   = 0
$rounds  = 0
$stall   = 0

for ($i = 1; $i -le $MaxRounds; $i++) {
  $rounds = $i
  try {
    $resp = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get -TimeoutSec 300
  } catch {
    Write-Error "Round $i failed: $($_.Exception.Message)"
    exit 1
  }

  $batch   = [int]$resp.batch
  $updated = [int]$resp.updated
  $skipped = [int]$resp.skipped
  $blocked = $resp.blocked
  Write-Host ("[round {0}] batch={1} updated={2} skipped={3}" -f $i, $batch, $updated, $skipped)
  if ($blocked) {
    foreach ($b in $blocked) {
      Write-Host ("  blocked: {0} for {1}s" -f $b.host, $b.secondsRemaining)
    }
  }
  $total += $updated

  if ($batch -eq 0) {
    # No rows match the (un-blocked, un-attempted) query. If we have an
    # active host block, sleep until it clears — there are likely blocked
    # rows still in the DB that will become eligible. Otherwise we're done.
    if ($blocked) {
      $maxBlock = ($blocked | Measure-Object -Property secondsRemaining -Maximum).Maximum
      $wait = [Math]::Min(120, [Math]::Max(5, [int]$maxBlock + 2))
      Write-Host ("  no eligible rows now; waiting {0}s for host block to clear" -f $wait)
      Start-Sleep -Seconds $wait
      continue
    }
    break
  }

  if ($updated -eq 0) {
    $stall++
    if ($stall -ge $MaxStallRounds) {
      Write-Host "  ! $stall consecutive empty rounds -- giving up; re-run later"
      break
    }
    # If the server reports an active block, wait that out; otherwise the
    # default stall sleep covers transient network blips.
    if ($blocked) {
      $maxBlock = ($blocked | Measure-Object -Property secondsRemaining -Maximum).Maximum
      $wait = [Math]::Min(120, [Math]::Max(5, [int]$maxBlock + 2))
    } else {
      $wait = $StallSleepSec
    }
    Write-Host ("  ... no progress; sleeping {0}s" -f $wait)
    Start-Sleep -Seconds $wait
  } else {
    $stall = 0
  }
}

Write-Host ""
Write-Host ("done -- {0} rows updated across {1} round(s)" -f $total, $rounds)
