$ErrorActionPreference = "Stop"

$repository = "NeoXider/neoxider-agent-deck"
$release = Invoke-RestMethod -TimeoutSec 30 -Headers @{ "User-Agent" = "NeoXider-Agent-Deck-Installer" } -Uri "https://api.github.com/repos/$repository/releases/latest"
$tag = [string]$release.tag_name
if ($release.draft -or $release.prerelease -or $tag -notmatch '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw "The latest GitHub release is not a stable published version." }
$version = $tag.Substring(1)
$assetName = "NeoXider-Agent-Deck-$version-windows-x64-portable.exe"
$asset = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
if (-not $asset) { throw "The latest release does not contain a portable Windows executable." }
if ([string]$asset.state -ne "uploaded") { throw "The portable Windows executable is not ready." }
$assetSize = [long]$asset.size
if ($assetSize -le 0 -or $assetSize -gt 268435456) { throw "The portable Windows executable has an invalid size." }
$expectedUrl = "https://github.com/$repository/releases/download/$tag/$assetName"
if ([string]$asset.browser_download_url -ne $expectedUrl) { throw "The portable Windows executable has an unexpected download address." }
$digest = [string]$asset.digest
if ($digest -notmatch '^sha256:[0-9a-fA-F]{64}$') { throw "The release asset does not include a valid SHA-256 digest." }
$expectedHash = $digest.Substring(7).ToLowerInvariant()

$installDirectory = Join-Path $env:LOCALAPPDATA "NeoXider\Agent Deck"
New-Item -ItemType Directory -Force -Path $installDirectory | Out-Null
$executable = Join-Path $installDirectory "NeoXider Agent Deck.exe"
$temporary = Join-Path $installDirectory (".agent-deck-download-" + [Guid]::NewGuid().ToString("N") + ".exe")
$rollback = Join-Path $installDirectory "NeoXider Agent Deck.rollback.exe"

try {
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.AllowAutoRedirect = $true
  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.Timeout = [TimeSpan]::FromMinutes(5)
  $client.DefaultRequestHeaders.UserAgent.ParseAdd("NeoXider-Agent-Deck-Installer")
  $response = $client.GetAsync([string]$asset.browser_download_url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  $response.EnsureSuccessStatusCode()
  if ($response.Content.Headers.ContentLength.HasValue -and $response.Content.Headers.ContentLength.Value -ne $assetSize) {
    throw "The server reported an unexpected executable size."
  }
  $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
  $outputStream = [System.IO.File]::Open($temporary, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $buffer = New-Object byte[] (1024 * 1024)
  $received = [long]0
  try {
    while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $received += $read
      if ($received -gt $assetSize -or $received -gt 268435456) { throw "The executable exceeded its verified release size." }
      $outputStream.Write($buffer, 0, $read)
    }
  } finally {
    $outputStream.Dispose()
    $inputStream.Dispose()
    $response.Dispose()
    $client.Dispose()
    $handler.Dispose()
  }
  if ($received -ne $assetSize) { throw "The downloaded executable size does not match the release metadata." }
  $actualHash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) { throw "Downloaded executable failed SHA-256 verification." }

  if (Test-Path -LiteralPath $executable) {
    [System.IO.File]::Replace($temporary, $executable, $rollback, $true)
    Remove-Item -LiteralPath $rollback -Force -ErrorAction SilentlyContinue
  } else {
    Move-Item -LiteralPath $temporary -Destination $executable
  }
} catch {
  throw "Installation failed. Close NeoXider Agent Deck if it is running, then retry. $($_.Exception.Message)"
} finally {
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
}

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "NeoXider Agent Deck.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $executable
$shortcut.WorkingDirectory = $installDirectory
$shortcut.IconLocation = "$executable,0"
$shortcut.Description = "NeoXider Agent Deck for DeepSeek Harness"
$shortcut.Save()

Write-Host "Installed: $executable"
Write-Host "Desktop shortcut: $shortcutPath"
Start-Process -FilePath $executable
