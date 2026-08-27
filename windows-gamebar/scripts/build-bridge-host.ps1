param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [switch]$SkipPublish
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$hostProject = Join-Path $root 'NeoXiderAgentDeck.BridgeHost\NeoXiderAgentDeck.BridgeHost.csproj'
$testProject = Join-Path $root 'NeoXiderAgentDeck.BridgeHost.Tests\NeoXiderAgentDeck.BridgeHost.Tests.csproj'
$publishDirectory = Join-Path $root 'artifacts\bridge-host\win-x64'

dotnet restore $hostProject --runtime win-x64
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

dotnet build $hostProject --configuration $Configuration --runtime win-x64 --no-restore
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

dotnet run --project $testProject --configuration $Configuration --runtime win-x64
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $SkipPublish) {
    dotnet publish $hostProject `
        --configuration $Configuration `
        --runtime win-x64 `
        --self-contained true `
        -p:PublishTrimmed=true `
        -p:TrimMode=partial `
        --output $publishDirectory
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $executable = Join-Path $publishDirectory 'NeoXiderAgentDeck.BridgeHost.exe'
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw "Published bridge host executable was not created: $executable"
    }

    $maximumPublishedBytes = 20MB
    $publishedBytes = (Get-Item -LiteralPath $executable).Length
    if ($publishedBytes -le 0 -or $publishedBytes -ge $maximumPublishedBytes) {
        throw "Published bridge host is unexpectedly large: $publishedBytes bytes (limit: $maximumPublishedBytes)."
    }

    Write-Host "Published bridge host: $executable ($publishedBytes bytes)"
}
