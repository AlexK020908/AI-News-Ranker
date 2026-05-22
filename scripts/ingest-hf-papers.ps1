$ErrorActionPreference = "Continue"

$envFile = Join-Path $PSScriptRoot "..\.env.local"

function Read-Env([string]$key) {
  $line = Get-Content $envFile | Where-Object { $_ -match "^$key=" } | Select-Object -First 1
  if (-not $line) { return $null }
  $val = $line -replace "^$key=", ''
  $val = $val.TrimEnd("`r").Trim()
  if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Substring(1, $val.Length - 2) }
  if ($val.StartsWith("'") -and $val.EndsWith("'")) { $val = $val.Substring(1, $val.Length - 2) }
  return $val
}

$secret = Read-Env "CRON_SECRET"
if (-not $secret) { throw "CRON_SECRET not found in .env.local" }

$base    = "http://localhost:3000"
$headers = @{ Authorization = "Bearer $secret"; "Content-Type" = "application/json" }

Write-Host "Ensuring 'hf-daily-papers' source row exists..." -ForegroundColor Cyan

$body = '{"slug":"hf-daily-papers","name":"HF Daily Papers","kind":"huggingface_papers","region":"global","config":{"max_results":50},"poll_interval_sec":3600}'

try {
  $r = Invoke-RestMethod -Method Post -Uri "$base/api/admin/sources" -Headers $headers -Body $body -TimeoutSec 30
  if ($r.created) {
    Write-Host "  source row created (id=$($r.source.id))" -ForegroundColor Green
  } else {
    Write-Host "  source already exists (id=$($r.source.id))" -ForegroundColor DarkGray
  }
} catch {
  $msg = $_.Exception.Message
  Write-Host "  ! source upsert failed: $msg" -ForegroundColor Red
  if ($_.Exception.Response) {
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $respBody = $reader.ReadToEnd()
      if ($respBody) { Write-Host "  Response body: $respBody" -ForegroundColor Yellow }
    } catch {}
  }
  Write-Host "  Likely causes:" -ForegroundColor Yellow
  Write-Host "    - Dev server not running (start with: npm run dev)" -ForegroundColor Yellow
  Write-Host "    - Migration 007 not applied (paste supabase/migrations/007_hf_papers_kind.sql in Supabase SQL editor)" -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "Triggering /api/jobs/ingest?only=hf-daily-papers..." -ForegroundColor Cyan

try {
  $r = Invoke-RestMethod -Uri "$base/api/jobs/ingest?only=hf-daily-papers" -Headers @{ Authorization = "Bearer $secret" } -TimeoutSec 120
  $msg = "  sources={0} attempted={1} inserted={2} skipped={3} errored={4}" -f $r.summary.sources, $r.summary.attempted, $r.summary.inserted, $r.summary.skipped, $r.summary.errored
  Write-Host $msg -ForegroundColor Green

  $errored = $r.results | Where-Object { $_.error }
  if ($errored) {
    Write-Host ""
    Write-Host "Errors:" -ForegroundColor Yellow
    foreach ($e in $errored) {
      $line = "  {0,-24} {1}" -f $e.sourceSlug, $e.error
      Write-Host $line
    }
  }
} catch {
  Write-Host "  ! ingest failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Done. Run .\scripts\catchup.ps1 to enrich + cluster the new papers." -ForegroundColor Cyan
