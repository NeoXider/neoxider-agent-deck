$ErrorActionPreference = "Stop"

$repository = "NeoXider/deepseek-harness-widget"
$release = Invoke-RestMethod -Headers @{ "User-Agent" = "DeepSeek-Harness-Widget-Installer" } -Uri "https://api.github.com/repos/$repository/releases/latest"
$asset = $release.assets | Where-Object { $_.name -like "DeepSeek-Harness-Widget-*-portable.exe" } | Select-Object -First 1
if (-not $asset) { throw "The latest release does not contain a portable Windows executable." }

$installDirectory = Join-Path $env:LOCALAPPDATA "NeoXider\DeepSeek Harness Widget"
New-Item -ItemType Directory -Force -Path $installDirectory | Out-Null
$executable = Join-Path $installDirectory "DeepSeek Harness Widget.exe"
Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $executable

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "DeepSeek Harness Widget.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $executable
$shortcut.WorkingDirectory = $installDirectory
$shortcut.IconLocation = "$executable,0"
$shortcut.Description = "Animated DeepSeek Harness desktop companion"
$shortcut.Save()

Write-Host "Installed: $executable"
Write-Host "Desktop shortcut: $shortcutPath"
Start-Process -FilePath $executable
