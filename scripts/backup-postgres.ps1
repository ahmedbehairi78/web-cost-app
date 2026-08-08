param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [string]$BackupDir = ".\backups"
)

if (-not $DatabaseUrl) {
  $DatabaseUrl = "postgresql://postgres:postgres@localhost:5432/web_cost_app"
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$file = Join-Path $BackupDir "web_cost_app-$timestamp.dump"

pg_dump --format=custom --file=$file $DatabaseUrl
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed"
}

Write-Host "Backup written to $file"
