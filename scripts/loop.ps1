 $ErrorActionPreference = "Continue"                                                                                                                     
  
  # Read CRON_SECRET from .env.local so no secret lives in this script.
  $envFile = Join-Path $PSScriptRoot "..\.env.local"
  $secret = (Get-Content $envFile | Where-Object { $_ -match '^CRON_SECRET=' }) -replace '^CRON_SECRET=', ''
  if (-not $secret) { throw "CRON_SECRET not found in .env.local" }

  $base    = "http://localhost:3000"
  $headers = @{ Authorization = "Bearer $secret" }

  function Hit($path) {
    try {
      $r = Invoke-RestMethod -Uri "$base$path" -Headers $headers -TimeoutSec 300
      return $r
    } catch {
      Write-Host "  ! $path failed: $($_.Exception.Message)" -ForegroundColor Yellow
      return $null
    }
  }

  while ($true) {
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] ingest..." -NoNewline
    $ing = Hit "/api/jobs/ingest"
    if ($ing) {
      Write-Host " inserted=$($ing.summary.inserted) pruned=$($ing.summary.pruned)"
    } else { Write-Host "" }

    Write-Host "[$ts] enrich..." -NoNewline
    $enr = Hit "/api/jobs/enrich"
    if ($enr) {
      Write-Host " batch=$($enr.batch) enriched=$($enr.enriched) failed=$($enr.failed)"
    } else { Write-Host "" }

    Write-Host "[$ts] cluster..." -NoNewline
    $cl = Hit "/api/jobs/cluster-topics"
    if ($cl) {
      Write-Host " clusters=$($cl.clusters) labeled=$($cl.labeled) reused=$($cl.reused)"
    } else { Write-Host "" }

    Write-Host "[$ts] cluster-tweets..." -NoNewline
    $cx = Hit "/api/jobs/cluster-tweets"
    if ($cx) {
      Write-Host " clusters=$($cx.clusters) labeled=$($cx.labeled) reused=$($cx.reused)"
    } else { Write-Host "" }

    Write-Host "[$ts] x-brief..." -NoNewline
    $xb = Hit "/api/jobs/x-brief"
    if ($xb) {
      if ($xb.skipped) { Write-Host " skipped" } else { Write-Host " generated sources=$($xb.sources)" }
    } else { Write-Host "" }

    Write-Host "[$ts] notify..." -NoNewline
    $nf = Hit "/api/jobs/notify"
    if ($nf) {
      Write-Host " delivered=$($nf.delivered)"
    } else { Write-Host "" }

    # Digest is idempotent per-day: cheap to hit every tick; no-ops outside
    # the daily window. No need to gate the call here.
    Write-Host "[$ts] digest..." -NoNewline
    $dg = Hit "/api/jobs/digest"
    if ($dg) {
      if ($dg.skipped) {
        Write-Host " skipped"
      } else {
        Write-Host " pushed=$($dg.pushed) items=$($dg.item_count)"
      }
    } else { Write-Host "" }

    Start-Sleep -Seconds 900
  }