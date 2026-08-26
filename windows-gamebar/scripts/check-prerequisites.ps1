[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$failures = [System.Collections.Generic.List[string]]::new()
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'

$gameBar = Get-AppxPackage -Name Microsoft.XboxGamingOverlay -ErrorAction SilentlyContinue
if (-not $gameBar) {
    $failures.Add('Xbox Game Bar is not installed for the current Windows user.')
}

$visualStudio = $null
if (-not (Test-Path -LiteralPath $vswhere)) {
    $failures.Add('Visual Studio Installer / vswhere was not found.')
} else {
    $visualStudio = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Workload.Universal -property installationPath
    if (-not $visualStudio) {
        $failures.Add('Visual Studio 2022 is installed, but the Universal Windows Platform development workload is missing.')
    }
}

$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
$sdkReference = Join-Path $sdkRoot 'References\10.0.19041.0\Windows.Foundation.FoundationContract\3.0.0.0\Windows.Foundation.FoundationContract.winmd'
$sdkPlatform = Join-Path $sdkRoot 'Platforms\UAP\10.0.19041.0\Platform.xml'
if (-not (Test-Path -LiteralPath $sdkReference) -or -not (Test-Path -LiteralPath $sdkPlatform)) {
    $failures.Add('Windows 10 SDK 10.0.19041.0 UWP references are missing.')
}

if ($visualStudio) {
    $xamlTarget = Join-Path $visualStudio 'MSBuild\Microsoft\WindowsXaml\v17.0\Microsoft.Windows.UI.Xaml.CSharp.targets'
    if (-not (Test-Path -LiteralPath $xamlTarget)) {
        $failures.Add('UWP XAML build targets are missing from Visual Studio 2022.')
    }
}

if ($failures.Count -gt 0) {
    Write-Host 'NeoXider Agent Deck Game Bar prerequisites: NOT READY' -ForegroundColor Red
    foreach ($failure in $failures) {
        Write-Host " - $failure" -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host 'Open Visual Studio Installer > Modify > Universal Windows Platform development.'
    Write-Host 'Under Individual components, include Windows 10 SDK (10.0.19041.0).'
    exit 1
}

Write-Host 'NeoXider Agent Deck Game Bar prerequisites: READY' -ForegroundColor Green
Write-Host "Xbox Game Bar: $($gameBar.Version)"
Write-Host "Visual Studio: $visualStudio"
Write-Host 'Windows SDK: 10.0.19041.0'
