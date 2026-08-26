$ErrorActionPreference = "Stop"

$repository = "NeoXider/neoxider-agent-deck"
$release = Invoke-RestMethod -Headers @{ "User-Agent" = "NeoXider-Agent-Deck-Installer" } -Uri "https://api.github.com/repos/$repository/releases/latest"
$asset = $release.assets | Where-Object { $_.name -like "NeoXider-Agent-Deck-*-windows-*-portable.exe" } | Select-Object -First 1
if (-not $asset) { throw "The latest release does not contain a portable Windows executable." }

$installDirectory = Join-Path $env:LOCALAPPDATA "NeoXider\Agent Deck"
New-Item -ItemType Directory -Force -Path $installDirectory | Out-Null
$executable = Join-Path $installDirectory "NeoXider Agent Deck.exe"
Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $executable

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
