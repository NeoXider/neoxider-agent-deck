[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts\gamebar-sideload'),
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $root
$project = Join-Path $root 'NeoXiderAgentDeck.GameBar\NeoXiderAgentDeck.GameBar.csproj'
$manifest = Join-Path $root 'NeoXiderAgentDeck.GameBar\Package.appxmanifest'
$installerSource = Join-Path $PSScriptRoot 'install-sideload-package.ps1'
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "neoxider-gamebar-$([guid]::NewGuid().ToString('N'))"
$certificate = $null
$trustedCertificateImported = $false

if (-not $Version) {
    $packageJson = Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json
    $Version = [string]$packageJson.version
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Invalid package version: $Version"
}
$packageVersion = "$Version.0"
$manifestBytes = [System.IO.File]::ReadAllBytes($manifest)

[xml]$manifestXml = Get-Content -LiteralPath $manifest -Raw
$identity = $manifestXml.Package.Identity
if ($identity.Name -ne 'NeoXider.AgentDeck.GameBar' -or $identity.Publisher -ne 'CN=NeoXider') {
    throw 'The package identity or publisher does not match the sideload contract.'
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
    throw 'Visual Studio Installer / vswhere is unavailable.'
}
$msbuild = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Workload.Universal -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
if (-not $msbuild) {
    throw 'MSBuild for the UWP workload was not found.'
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $resolvedOutput) {
    Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
}
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null

$pfxPath = Join-Path $temporaryRoot 'signing.pfx'
$cerPath = Join-Path $temporaryRoot 'signing.cer'
$appxOutput = Join-Path $temporaryRoot 'AppPackages'
$passwordText = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$password = ConvertTo-SecureString -String $passwordText -AsPlainText -Force

try {
    $manifestXml.Package.Identity.Version = $packageVersion
    [System.IO.File]::WriteAllText($manifest, $manifestXml.OuterXml, [System.Text.UTF8Encoding]::new($false))

    $certificate = New-SelfSignedCertificate `
        -Type Custom `
        -Subject 'CN=NeoXider' `
        -FriendlyName 'NeoXider Agent Deck ephemeral Game Bar sideload certificate' `
        -CertStoreLocation Cert:\CurrentUser\My `
        -KeyAlgorithm RSA `
        -KeyLength 3072 `
        -HashAlgorithm SHA256 `
        -KeyExportPolicy Exportable `
        -KeyUsage DigitalSignature `
        -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}') `
        -NotAfter (Get-Date).AddYears(1)

    Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $password -Force | Out-Null
    Export-Certificate -Cert $certificate -FilePath $cerPath -Type CERT -Force | Out-Null
    Import-Certificate -FilePath $cerPath -CertStoreLocation Cert:\CurrentUser\TrustedPeople | Out-Null
    $trustedCertificateImported = $true

    & $msbuild $project /restore /m /t:Rebuild `
        /p:Configuration=Release `
        /p:Platform=x64 `
        /p:AppxPackageSigningEnabled=true `
        /p:PackageCertificateKeyFile=$pfxPath `
        /p:PackageCertificatePassword=$passwordText `
        /p:PackageCertificateThumbprint=$($certificate.Thumbprint) `
        /p:GenerateAppxPackageOnBuild=true `
        /p:GenerateAppInstallerFile=false `
        /p:UapAppxPackageBuildMode=SideloadOnly `
        /p:AppxBundle=Never `
        /p:AppxPackageVersion=$packageVersion `
        /p:AppxPackageDir=$appxOutput\
    if ($LASTEXITCODE -ne 0) {
        throw "Signed Game Bar package build failed with exit code $LASTEXITCODE."
    }

    $packages = @(Get-ChildItem -LiteralPath $appxOutput -Recurse -File |
        Where-Object {
            $_.Extension -in @('.appx', '.msix') -and
            $_.FullName -notmatch '[\\/]Dependencies[\\/]'
        })
    if ($packages.Count -ne 1) {
        throw "Expected one x64 AppX/MSIX package, found $($packages.Count)."
    }

    $extension = '.appx'
    $baseName = "NeoXider-Agent-Deck-GameBar-$Version-windows-x64"
    $packageDestination = Join-Path $resolvedOutput "$baseName$extension"
    $certificateDestination = Join-Path $resolvedOutput "$baseName.cer"
    $installerDestination = Join-Path $resolvedOutput 'Install-NeoXider-Agent-Deck-GameBar.ps1'
    Copy-Item -LiteralPath $packages[0].FullName -Destination $packageDestination -Force
    Copy-Item -LiteralPath $cerPath -Destination $certificateDestination -Force
    Copy-Item -LiteralPath $installerSource -Destination $installerDestination -Force

    $dependencySource = Join-Path $appxOutput 'Dependencies'
    if (-not (Test-Path -LiteralPath $dependencySource)) {
        $dependencySource = Get-ChildItem -LiteralPath $appxOutput -Directory -Recurse |
            Where-Object Name -eq 'Dependencies' |
            Select-Object -First 1 -ExpandProperty FullName
    }
    if ($dependencySource -and (Test-Path -LiteralPath $dependencySource)) {
        Copy-Item -LiteralPath $dependencySource -Destination (Join-Path $resolvedOutput 'Dependencies') -Recurse -Force
    }

    @"
NeoXider Agent Deck Game Bar companion $Version (x64)

1. Extract this ZIP completely.
2. Right-click Install-NeoXider-Agent-Deck-GameBar.ps1 and run it with PowerShell.
3. Press Win+G, open Widgets, select NeoXider Agent Deck, and pin it.

The .cer file is a public-only release-specific development certificate generated by CI.
The private key and PFX are never included in artifacts or releases.
"@ | Set-Content -LiteralPath (Join-Path $resolvedOutput 'INSTALL.txt') -Encoding utf8

    & (Join-Path $PSScriptRoot 'verify-sideload-package.ps1') -Directory $resolvedOutput -Version $Version
    if ($LASTEXITCODE -ne 0) {
        throw "Sideload package verification failed with exit code $LASTEXITCODE."
    }

    $zipPath = Join-Path $resolvedOutput "$baseName.zip"
    $zipItems = @(Get-ChildItem -LiteralPath $resolvedOutput | Where-Object FullName -ne $zipPath)
    Compress-Archive -LiteralPath $zipItems.FullName -DestinationPath $zipPath -CompressionLevel Optimal
    if (-not (Test-Path -LiteralPath $zipPath) -or (Get-Item -LiteralPath $zipPath).Length -le 0) {
        throw 'The sideload ZIP was not created.'
    }

    Write-Host "Signed Game Bar sideload kit: $resolvedOutput" -ForegroundColor Green
} finally {
    [System.IO.File]::WriteAllBytes($manifest, $manifestBytes)
    if ($certificate -and $trustedCertificateImported) {
        Remove-Item -LiteralPath "Cert:\CurrentUser\TrustedPeople\$($certificate.Thumbprint)" -Force -ErrorAction SilentlyContinue
    }
    if ($certificate) {
        Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($certificate.Thumbprint)" -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
    $passwordText = $null
    $password = $null
}

$forbidden = @(Get-ChildItem -LiteralPath $resolvedOutput -Recurse -File |
    Where-Object Extension -in @('.pfx', '.p12', '.pvk', '.key'))
if ($forbidden.Count -gt 0) {
    throw 'A private-key artifact escaped into the sideload output.'
}
