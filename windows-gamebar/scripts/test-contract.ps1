[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$projectRoot = Join-Path $root 'NeoXiderAgentDeck.GameBar'
$failures = [System.Collections.Generic.List[string]]::new()

function Require-Text {
    param([string]$Path, [string]$Pattern, [string]$Message)
    $content = Get-Content -LiteralPath $Path -Raw
    if ($content -notmatch $Pattern) {
        $script:failures.Add($Message)
    }
}

$manifestPath = Join-Path $projectRoot 'Package.appxmanifest'
$projectPath = Join-Path $projectRoot 'NeoXiderAgentDeck.GameBar.csproj'
$appPath = Join-Path $projectRoot 'App.xaml.cs'
$bridgePath = Join-Path $root 'BRIDGE_PROTOCOL.md'

[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw
$namespace = [System.Xml.XmlNamespaceManager]::new($manifest.NameTable)
$namespace.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
$namespace.AddNamespace('uap3', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/3')
$extension = $manifest.SelectSingleNode('//uap3:AppExtension[@Name="microsoft.gameBarUIExtension"]', $namespace)
if (-not $extension) { $failures.Add('Game Bar app extension is missing.') }
if ($extension -and $extension.Id -ne 'AgentDeckStatus') { $failures.Add('Unexpected Game Bar app extension id.') }

Require-Text $manifestPath '<PinningSupported>true</PinningSupported>' 'Pinning must be enabled.'
Require-Text $manifestPath '<MinWidth>240</MinWidth>' 'The official 240 epx desktop-mode minimum is not declared.'
Require-Text $projectPath 'Microsoft\.Gaming\.XboxGameBar' 'The official Game Bar SDK package reference is missing.'
Require-Text $projectPath '10\.0\.19041\.0' 'Windows SDK 19041 target is missing.'
Require-Text $appPath 'XboxGameBarWidgetActivatedEventArgs' 'Game Bar protocol activation handling is missing.'
Require-Text $appPath 'IsLaunchActivation' 'Launch activation handling is missing.'
Require-Text $bridgePath '\\\\.\\pipe\\NeoXider\.AgentDeck\.GameBar\.v1' 'The versioned named-pipe endpoint is missing from the bridge contract.'
Require-Text $bridgePath '65536' 'The bridge frame-size limit is missing.'

Add-Type -AssemblyName System.Drawing
$expectedAssets = @{
    'Assets\AgentAvatar.png' = @(256, 256)
    'Assets\Square150x150Logo.png' = @(150, 150)
    'Assets\Square44x44Logo.png' = @(44, 44)
    'Assets\StoreLogo.png' = @(50, 50)
}
foreach ($entry in $expectedAssets.GetEnumerator()) {
    $path = Join-Path $projectRoot $entry.Key
    if (-not (Test-Path -LiteralPath $path)) {
        $failures.Add("Missing asset: $($entry.Key)")
        continue
    }
    $image = [System.Drawing.Image]::FromFile($path)
    try {
        if ($image.Width -ne $entry.Value[0] -or $image.Height -ne $entry.Value[1]) {
            $failures.Add("Unexpected dimensions for $($entry.Key): $($image.Width)x$($image.Height)")
        }
    } finally {
        $image.Dispose()
    }
}

if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Error $failure }
    exit 1
}

Write-Host 'Game Bar companion contract: PASS' -ForegroundColor Green
