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
    $ing = Hit "/api/cron/ingest"
    if ($ing) {
      Write-Host " inserted=$($ing.summary.inserted) pruned=$($ing.summary.pruned)"
    } else { Write-Host "" }

    Write-Host "[$ts] enrich..." -NoNewline
    $enr = Hit "/api/cron/enrich"
    if ($enr) {
      Write-Host " batch=$($enr.batch) enriched=$($enr.enriched) failed=$($enr.failed)"
    } else { Write-Host "" }

    Start-Sleep -Seconds 900
  }