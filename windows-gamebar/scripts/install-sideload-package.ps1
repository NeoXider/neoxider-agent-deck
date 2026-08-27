[CmdletBinding()]
param(
    [string]$PackagePath,
    [string]$CertificatePath
)

$ErrorActionPreference = 'Stop'

function Resolve-SingleArtifact {
    param(
        [string]$ExplicitPath,
        [string]$Pattern,
        [string]$Label
    )

    if ($ExplicitPath) {
        return (Resolve-Path -LiteralPath $ExplicitPath).Path
    }

    $matches = @(Get-ChildItem -LiteralPath $PSScriptRoot -File -Filter $Pattern)
    if ($matches.Count -ne 1) {
        throw "Expected exactly one $Label next to this script, found $($matches.Count)."
    }
    return $matches[0].FullName
}

$package = Resolve-SingleArtifact $PackagePath 'NeoXider-Agent-Deck-GameBar-*-windows-x64.appx' 'Game Bar AppX package'
$certificate = Resolve-SingleArtifact $CertificatePath 'NeoXider-Agent-Deck-GameBar-*-windows-x64.cer' 'public signing certificate'

$publicCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificate)
if ($publicCertificate.Subject -ne 'CN=NeoXider' -or $publicCertificate.HasPrivateKey) {
    throw 'The companion certificate must be the public-only CN=NeoXider development certificate.'
}

$signature = Get-AuthenticodeSignature -LiteralPath $package
if ($signature.Status -in @('NotSigned', 'HashMismatch', 'NotSupportedFileFormat') -or
    -not $signature.SignerCertificate -or
    $signature.SignerCertificate.Thumbprint -ne $publicCertificate.Thumbprint) {
    throw 'The AppX signature does not match the supplied public certificate.'
}

$trusted = Get-ChildItem -LiteralPath Cert:\CurrentUser\TrustedPeople |
    Where-Object Thumbprint -eq $publicCertificate.Thumbprint |
    Select-Object -First 1
if (-not $trusted) {
    Import-Certificate -FilePath $certificate -CertStoreLocation Cert:\CurrentUser\TrustedPeople | Out-Null
}

$trustedSignature = Get-AuthenticodeSignature -LiteralPath $package
if ($trustedSignature.Status -ne 'Valid' -or
    -not $trustedSignature.SignerCertificate -or
    $trustedSignature.SignerCertificate.Thumbprint -ne $publicCertificate.Thumbprint) {
    throw "The trusted AppX signature is not valid (status: $($trustedSignature.Status))."
}

$dependencyRoot = Join-Path $PSScriptRoot 'Dependencies'
$dependencies = @()
if (Test-Path -LiteralPath $dependencyRoot) {
    $dependencies = @(Get-ChildItem -LiteralPath $dependencyRoot -Recurse -File |
        Where-Object Extension -in @('.appx', '.msix') |
        Select-Object -ExpandProperty FullName)
}

$arguments = @{
    Path = $package
    ForceApplicationShutdown = $true
}
if ($dependencies.Count -gt 0) {
    $arguments.DependencyPath = $dependencies
}

Add-AppxPackage @arguments
Write-Host 'NeoXider Agent Deck Game Bar companion installed. Press Win+G, open Widgets, then pin NeoXider Agent Deck.' -ForegroundColor Green
