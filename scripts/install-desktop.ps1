$ErrorActionPreference = "Stop"

$repository = "NeoXider/neoxider-agent-deck"
$release = Invoke-RestMethod -Headers @{ "User-Agent" = "NeoXider-Agent-Deck-Installer" } -Uri "https://api.github.com/repos/$repository/releases/latest"
$asset = $release.assets | Where-Object { $_.name -like "NeoXider-Agent-Deck-*-windows-*-portable.exe" } | Select-Object -First 1
if (-not $asset) { throw "The latest release does not contain a portable Windows executable." }
$digest = [string]$asset.digest
if ($digest -notmatch '^sha256:[0-9a-fA-F]{64}$') { throw "The release asset does not include a valid SHA-256 digest." }
$expectedHash = $digest.Substring(7).ToLowerInvariant()

$installDirectory = Join-Path $env:LOCALAPPDATA "NeoXider\Agent Deck"
New-Item -ItemType Directory -Force -Path $installDirectory | Out-Null
$executable = Join-Path $installDirectory "NeoXider Agent Deck.exe"
$temporary = Join-Path $installDirectory (".agent-deck-download-" + [Guid]::NewGuid().ToString("N") + ".exe")
$rollback = Join-Path $installDirectory "NeoXider Agent Deck.rollback.exe"

try {
  Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $temporary
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
