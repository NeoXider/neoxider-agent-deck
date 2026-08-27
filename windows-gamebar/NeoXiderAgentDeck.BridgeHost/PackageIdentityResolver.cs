using Windows.ApplicationModel;
using Windows.Management.Deployment;

namespace NeoXiderAgentDeck.BridgeHost;

internal sealed record PackageIdentityCandidate(
    string Name,
    string Publisher,
    string FamilyName,
    ulong Version);

internal static class PackageIdentitySelection
{
    internal static PackageIdentityCandidate Select(
        IEnumerable<PackageIdentityCandidate> candidates,
        string expectedName,
        string expectedPublisher)
    {
        ArgumentNullException.ThrowIfNull(candidates);

        var matches = candidates
            .Where(candidate =>
                string.Equals(candidate.Name, expectedName, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(candidate.Publisher, expectedPublisher, StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(candidate.FamilyName))
            .ToArray();

        if (matches.Length == 0)
        {
            throw new BridgeStartupException(
                $"The installed Game Bar package '{expectedName}' was not found for the current user.");
        }

        var families = matches
            .Select(candidate => candidate.FamilyName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (families.Length != 1)
        {
            throw new BridgeStartupException(
                $"More than one package family matched '{expectedName}'; refusing to choose an identity.");
        }

        return matches
            .OrderByDescending(candidate => candidate.Version)
            .First();
    }
}

internal sealed class PackageIdentityResolver
{
    internal PackageIdentityCandidate Resolve()
    {
        try
        {
            var manager = new PackageManager();
            var candidates = manager
                .FindPackagesForUser(
                    string.Empty,
                    BridgeConstants.PackageIdentityName,
                    BridgeConstants.PackagePublisher)
                .Select(ToCandidate)
                .ToArray();

            return PackageIdentitySelection.Select(
                candidates,
                BridgeConstants.PackageIdentityName,
                BridgeConstants.PackagePublisher);
        }
        catch (BridgeStartupException)
        {
            throw;
        }
        catch (Exception exception)
        {
            throw new BridgeStartupException(
                "Windows package identity lookup failed; the bridge will not open an unauthenticated pipe.",
                exception);
        }
    }

    private static PackageIdentityCandidate ToCandidate(Package package)
    {
        PackageId id = package.Id;
        PackageVersion version = id.Version;
        ulong packedVersion =
            ((ulong)version.Major << 48) |
            ((ulong)version.Minor << 32) |
            ((ulong)version.Build << 16) |
            version.Revision;

        return new PackageIdentityCandidate(
            id.Name,
            id.Publisher,
            id.FamilyName,
            packedVersion);
    }
}
