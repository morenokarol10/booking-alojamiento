$ErrorActionPreference = 'Stop'

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$packageId = [Guid]::NewGuid().ToString('N')
$stagingDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "alojamientos-azure-$packageId"
$outputDirectory = Join-Path $repositoryRoot 'dist'
$archivePath = Join-Path $outputDirectory 'alojamientos-azure.zip'
$archive = $null
$archiveStream = $null

try {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm must be installed and available on PATH.'
  }

  Push-Location $repositoryRoot
  try {
    npm run build
    if ($LASTEXITCODE -ne 0) {
      throw "NestJS build failed with exit code $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }

  New-Item -ItemType Directory -Path $stagingDirectory | Out-Null
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

  Copy-Item (Join-Path $repositoryRoot 'package.json') $stagingDirectory
  Copy-Item (Join-Path $repositoryRoot 'package-lock.json') $stagingDirectory
  Copy-Item (Join-Path $repositoryRoot 'dist') (Join-Path $stagingDirectory 'dist') -Recurse
  Copy-Item (Join-Path $repositoryRoot 'contracts') (Join-Path $stagingDirectory 'contracts') -Recurse
  Copy-Item (Join-Path $repositoryRoot 'database\migrations') (Join-Path $stagingDirectory 'database\migrations') -Recurse
  Copy-Item (Join-Path $repositoryRoot 'public') (Join-Path $stagingDirectory 'public') -Recurse

  npm ci --omit=dev --os=linux --cpu=x64 --libc=glibc --prefix $stagingDirectory
  if ($LASTEXITCODE -ne 0) {
    throw "Linux x64 production dependency installation failed with exit code $LASTEXITCODE."
  }

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }
  $archiveStream = [System.IO.File]::Open(
    $archivePath,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )
  $archive = [System.IO.Compression.ZipArchive]::new(
    $archiveStream,
    [System.IO.Compression.ZipArchiveMode]::Create,
    $false
  )
  Get-ChildItem -LiteralPath $stagingDirectory -File -Recurse -Force | ForEach-Object {
    $entryName = $_.FullName.Substring($stagingDirectory.Length).TrimStart('\', '/').Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive,
      $_.FullName,
      $entryName,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
  $archive.Dispose()
  $archive = $null
  $archiveStream.Dispose()
  $archiveStream = $null

  $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
  $entryNames = @($archive.Entries | ForEach-Object { $_.FullName })
  foreach ($requiredEntry in @('package.json', 'dist/main.js', 'contracts/alojamientos-openapi-v2.yaml', 'database/migrations/202611080001_alojamientos_v2_core.sql', 'public/index.html', 'node_modules/@nestjs/core/package.json')) {
    if ($entryNames -notcontains $requiredEntry) {
      throw "Azure package is missing required root entry '$requiredEntry'."
    }
  }

  Write-Output "Azure ZIP package ready: $archivePath"
}
catch {
  Write-Error $_
  exit 1
}
finally {
  if ($archive) {
    $archive.Dispose()
  }
  if ($archiveStream) {
    $archiveStream.Dispose()
  }
  if (Test-Path -LiteralPath $stagingDirectory) {
    Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
  }
}
