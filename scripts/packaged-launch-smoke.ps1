param(
  [string]$Executable = "release\win-unpacked\NeoXider Agent Deck.exe"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$target = if ([System.IO.Path]::IsPathRooted($Executable)) { $Executable } else { Join-Path $root $Executable }
$target = [System.IO.Path]::GetFullPath($target)
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Packaged executable not found: $target" }

$package = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$marker = Join-Path ([System.IO.Path]::GetTempPath()) ("neoxider-agent-deck-smoke-" + [Guid]::NewGuid().ToString("N") + ".json")
$previousMarker = $env:WIDGET_PACKAGED_SMOKE_PATH
$process = $null

try {
  $env:WIDGET_PACKAGED_SMOKE_PATH = $marker
  $process = Start-Process -FilePath $target -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while (-not (Test-Path -LiteralPath $marker) -and [DateTime]::UtcNow -lt $deadline) {
    if ($process.HasExited) { throw "Packaged application exited before its renderer became ready (exit code $($process.ExitCode))." }
    Start-Sleep -Milliseconds 100
    $process.Refresh()
  }
  if (-not (Test-Path -LiteralPath $marker)) { throw "Packaged application did not report a ready renderer within 20 seconds." }
  $receipt = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  if (-not $receipt.ready) { throw "Packaged application returned an invalid readiness receipt." }
  if ([string]$receipt.version -ne [string]$package.version) {
    throw "Packaged version $($receipt.version) does not match package version $($package.version)."
  }
  Write-Host "Packaged launch smoke passed: NeoXider Agent Deck $($receipt.version)"
} finally {
  if ($null -eq $previousMarker) { Remove-Item Env:WIDGET_PACKAGED_SMOKE_PATH -ErrorAction SilentlyContinue }
  else { $env:WIDGET_PACKAGED_SMOKE_PATH = $previousMarker }
  if ($process -and -not $process.HasExited) {
    $process.CloseMainWindow() | Out-Null
    if (-not $process.WaitForExit(3000)) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
}
