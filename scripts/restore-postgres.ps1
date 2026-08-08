param(
  [Parameter(Mandatory=$true)][string]$BackupFile,
  [string]$DatabaseUrl = $env:DATABASE_URL
)

if (-not $DatabaseUrl) {
  $DatabaseUrl = "postgresql://postgres:postgres@localhost:5432/web_cost_app"
}

pg_restore --clean --if-exists --no-owner --dbname=$DatabaseUrl $BackupFile
if ($LASTEXITCODE -ne 0) {
  throw "pg_restore failed"
}

Write-Host "Restore completed from $BackupFile"
