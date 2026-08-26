[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Debug'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'check-prerequisites.ps1')
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$msbuild = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Workload.Universal -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
if (-not $msbuild) {
    throw 'MSBuild for the UWP workload was not found.'
}

$solution = Join-Path $root 'NeoXiderAgentDeck.GameBar.sln'
& $msbuild $solution /restore /m /p:Configuration=$Configuration /p:Platform=x64
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
