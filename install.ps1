param(
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
$installDir = Join-Path $env:USERPROFILE ".vibin\bin"
$sourceExe = Join-Path $PSScriptRoot "dist\VibinSetup.exe"
$targetExe = Join-Path $installDir "vibin.exe"

if (-not (Test-Path -LiteralPath $sourceExe)) {
  throw "dist\VibinSetup.exe was not found. Build the setup executable first."
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item -LiteralPath $sourceExe -Destination $targetExe -Force

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$pathEntries = @($userPath -split ";" | Where-Object { $_.Trim() })
if ($pathEntries -notcontains $installDir) {
  [Environment]::SetEnvironmentVariable("Path", (($pathEntries + $installDir) -join ";"), "User")
  $env:Path = "$installDir;$env:Path"
}

Write-Host "Installed Vibin to $targetExe"
Write-Host "Open a new terminal, then run: vibin"
if (-not $NoLaunch) { Start-Process -FilePath $targetExe }
