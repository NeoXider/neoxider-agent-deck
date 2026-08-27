[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Directory,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version
)

$ErrorActionPreference = 'Stop'

function Read-EmbeddedManifest {
    param([Parameter(Mandatory = $true)][string]$PackagePath)

    $archive = [System.IO.Compression.ZipFile]::OpenRead($PackagePath)
    try {
        $manifestEntry = $archive.Entries | Where-Object FullName -eq 'AppxManifest.xml' | Select-Object -First 1
        if (-not $manifestEntry) {
            throw "The package does not contain AppxManifest.xml: $PackagePath"
        }
        $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
        try {
            return [xml]$reader.ReadToEnd()
        } finally {
            $reader.Dispose()
        }
    } finally {
        $archive.Dispose()
    }
}

$root = (Resolve-Path -LiteralPath $Directory).Path
$baseName = "NeoXider-Agent-Deck-GameBar-$Version-windows-x64"
$packages = @(Get-ChildItem -LiteralPath $root -File -Filter "$baseName.msix")
$certificates = @(Get-ChildItem -LiteralPath $root -File -Filter "$baseName.cer")
$installer = Join-Path $root 'Install-NeoXider-Agent-Deck-GameBar.ps1'

if ($packages.Count -ne 1 -or $certificates.Count -ne 1 -or -not (Test-Path -LiteralPath $installer)) {
    throw 'The sideload output must contain exactly one canonical package, one public certificate, and the installer.'
}
if ($packages[0].Length -le 0 -or $certificates[0].Length -le 0 -or (Get-Item -LiteralPath $installer).Length -le 0) {
    throw 'A required sideload artifact is empty.'
}
if (Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object Extension -in @('.pfx', '.p12', '.pvk', '.key')) {
    throw 'Private-key material is forbidden in the sideload output.'
}

$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificates[0].FullName)
if ($certificate.Subject -ne 'CN=NeoXider' -or $certificate.HasPrivateKey) {
    throw 'The exported certificate is not the expected public-only CN=NeoXider certificate.'
}

$signature = Get-AuthenticodeSignature -LiteralPath $packages[0].FullName
if ($signature.Status -ne 'Valid' -or
    -not $signature.SignerCertificate -or
    $signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint) {
    throw "The package signature is not valid or does not match the public certificate (status: $($signature.Status); message: $($signature.StatusMessage); signer: $($signature.SignerCertificate.Thumbprint); expected: $($certificate.Thumbprint))."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$manifest = Read-EmbeddedManifest -PackagePath $packages[0].FullName

$identity = $manifest.Package.Identity
if ($identity.Name -ne 'NeoXider.AgentDeck.GameBar' -or
    $identity.Publisher -ne 'CN=NeoXider' -or
    $identity.ProcessorArchitecture -ne 'x64' -or
    $identity.Version -ne "$Version.0") {
    throw "Unexpected embedded package identity: $($identity.Name), $($identity.Publisher), $($identity.ProcessorArchitecture), $($identity.Version)."
}

$dependencyRoot = Join-Path $root 'Dependencies'
$dependencyX64 = Join-Path $dependencyRoot 'x64'
$unexpectedDependencyDirectories = @()
if (Test-Path -LiteralPath $dependencyRoot) {
    $unexpectedDependencyDirectories = @(Get-ChildItem -LiteralPath $dependencyRoot -Directory |
        Where-Object Name -ne 'x64')
}
$dependencyPackages = @()
if (Test-Path -LiteralPath $dependencyX64) {
    $dependencyPackages = @(Get-ChildItem -LiteralPath $dependencyX64 -File |
        Where-Object Extension -in @('.appx', '.msix'))
}
if ($unexpectedDependencyDirectories.Count -gt 0 -or $dependencyPackages.Count -eq 0) {
    throw 'The sideload output must contain only a non-empty Dependencies\x64 package set.'
}
foreach ($dependencyPackage in $dependencyPackages) {
    $dependencyManifest = Read-EmbeddedManifest -PackagePath $dependencyPackage.FullName
    $dependencyArchitecture = [string]$dependencyManifest.Package.Identity.ProcessorArchitecture
    if ($dependencyArchitecture -notin @('x64', 'neutral')) {
        throw "Unexpected dependency architecture $dependencyArchitecture in $($dependencyPackage.Name)."
    }
}

Write-Host "Game Bar sideload package verified: $($packages[0].Name)" -ForegroundColor Green
