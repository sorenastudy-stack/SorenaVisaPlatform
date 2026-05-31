# Sorena Visa Platform — Weekly Backup Script

$SOURCE_DIR        = "D:\SorenaVisaPlatform"
$ONEDRIVE_BACKUP   = "C:\Users\OEM\OneDrive\Sorena-Backups"
$EXTERNAL_BACKUP   = "F:\Sorena-Backups"
$DB_USER           = "postgres"
$DB_NAME           = "sorenavisaplatform"
$DB_HOST           = "localhost"
$DB_PASSWORD       = "sorena2026"
$RETENTION_DAYS    = 56

$SECRETS_FILES = @(
  "D:\SorenaVisaPlatform\backend\.env",
  "D:\SorenaVisaPlatform\frontend\.env.local"
)
$SECRETS_FOLDERS = @(
  "D:\SorenaVisaPlatform\Sorena_Scoring_Reference"
)
$EXCLUDE_NAMES = @('node_modules', '.next', 'dist', 'build', '.turbo', 'coverage', 'logs')

$ErrorActionPreference = 'Continue'
$timestamp = Get-Date -Format "yyyy-MM-dd-HHmm"
$start = Get-Date

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " SORENA WEEKLY BACKUP - $timestamp" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

mkdir $ONEDRIVE_BACKUP -Force | Out-Null

Write-Host "[1/5] Dumping database..." -ForegroundColor Yellow
$env:PGPASSWORD = $DB_PASSWORD
$dbDumpFile = "$ONEDRIVE_BACKUP\sorena-db-$timestamp.dump"
pg_dump -U $DB_USER -h $DB_HOST -d $DB_NAME -F c -f $dbDumpFile 2>&1 | Out-Null
if (Test-Path $dbDumpFile) {
  Write-Host "      OK" -ForegroundColor Green
} else {
  Write-Host "      FAILED" -ForegroundColor Red
}

Write-Host "[2/5] Zipping secrets..." -ForegroundColor Yellow
$secretsTempDir = "$ONEDRIVE_BACKUP\secrets-temp-$timestamp"
mkdir $secretsTempDir -Force | Out-Null
foreach ($file in $SECRETS_FILES) {
  if (Test-Path $file) {
    $leaf = Split-Path $file -Leaf
    $parent = Split-Path (Split-Path $file -Parent) -Leaf
    Copy-Item $file "$secretsTempDir\$parent.$leaf"
  }
}
foreach ($folder in $SECRETS_FOLDERS) {
  if (Test-Path $folder) {
    Copy-Item $folder $secretsTempDir -Recurse
  }
}
$secretsZipFile = "$ONEDRIVE_BACKUP\sorena-secrets-$timestamp.zip"
Compress-Archive -Path "$secretsTempDir\*" -DestinationPath $secretsZipFile -Force
Remove-Item $secretsTempDir -Recurse -Force
Write-Host "      OK" -ForegroundColor Green

Write-Host "[3/5] Zipping project (about 1 minute)..." -ForegroundColor Yellow
$fullZipFile = "$ONEDRIVE_BACKUP\sorena-fullproject-$timestamp.zip"
$files = Get-ChildItem -Path $SOURCE_DIR -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object {
  $segments = $_.FullName.Split('\')
  $hit = $false
  foreach ($s in $segments) {
    if ($EXCLUDE_NAMES -contains $s) { $hit = $true; break }
  }
  -not $hit
}
$files | Compress-Archive -DestinationPath $fullZipFile -Force -ErrorAction SilentlyContinue
if (Test-Path $fullZipFile) {
  $sizeMB = [math]::Round((Get-Item $fullZipFile).Length / 1MB, 2)
  Write-Host "      OK - $sizeMB MB" -ForegroundColor Green
} else {
  Write-Host "      FAILED" -ForegroundColor Red
}

Write-Host "[4/5] Copying to external drive F:..." -ForegroundColor Yellow
if (Test-Path "F:\") {
  mkdir $EXTERNAL_BACKUP -Force | Out-Null
  Copy-Item "$ONEDRIVE_BACKUP\sorena-db-$timestamp.dump" $EXTERNAL_BACKUP -ErrorAction SilentlyContinue
  Copy-Item "$ONEDRIVE_BACKUP\sorena-secrets-$timestamp.zip" $EXTERNAL_BACKUP -ErrorAction SilentlyContinue
  Copy-Item "$ONEDRIVE_BACKUP\sorena-fullproject-$timestamp.zip" $EXTERNAL_BACKUP -ErrorAction SilentlyContinue
  Write-Host "      OK" -ForegroundColor Green
} else {
  Write-Host "      SKIPPED - F: not detected" -ForegroundColor Yellow
}

Write-Host "[5/5] Pruning backups older than $RETENTION_DAYS days..." -ForegroundColor Yellow
$cutoff = (Get-Date).AddDays(-$RETENTION_DAYS)
$pruned = 0
foreach ($location in @($ONEDRIVE_BACKUP, $EXTERNAL_BACKUP)) {
  if (Test-Path $location) {
    Get-ChildItem $location -File | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object {
      Remove-Item $_.FullName -Force
      $pruned++
    }
  }
}
Write-Host "      OK - pruned $pruned old files" -ForegroundColor Green

$elapsed = (Get-Date) - $start
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " BACKUP COMPLETE in $($elapsed.TotalSeconds.ToString('0')) seconds" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Get-ChildItem $ONEDRIVE_BACKUP | Sort LastWriteTime -Descending | Select -First 3 | Select Name, @{N='Size_MB';E={[math]::Round($_.Length / 1MB, 2)}} | Format-Table -AutoSize
Write-Host "Press any key to close..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
