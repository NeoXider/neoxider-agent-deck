[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Directory,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Directory).Path
$baseName = "NeoXider-Agent-Deck-GameBar-$Version-windows-x64"
$packages = @(Get-ChildItem -LiteralPath $root -File |
    Where-Object { $_.BaseName -eq $baseName -and $_.Extension -in @('.appx', '.msix') })
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
    throw "The package signature is not valid or does not match the public certificate (status: $($signature.Status))."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($packages[0].FullName)
try {
    $manifestEntry = $archive.Entries | Where-Object FullName -eq 'AppxManifest.xml' | Select-Object -First 1
    if (-not $manifestEntry) {
        throw 'The package does not contain AppxManifest.xml.'
    }
    $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
    try {
        [xml]$manifest = $reader.ReadToEnd()
    } finally {
        $reader.Dispose()
    }
} finally {
    $archive.Dispose()
}

$identity = $manifest.Package.Identity
if ($identity.Name -ne 'NeoXider.AgentDeck.GameBar' -or
    $identity.Publisher -ne 'CN=NeoXider' -or
    $identity.ProcessorArchitecture -ne 'x64' -or
    $identity.Version -ne "$Version.0") {
    throw "Unexpected embedded package identity: $($identity.Name), $($identity.Publisher), $($identity.ProcessorArchitecture), $($identity.Version)."
}

Write-Host "Game Bar sideload package verified: $($packages[0].Name)" -ForegroundColor Green
