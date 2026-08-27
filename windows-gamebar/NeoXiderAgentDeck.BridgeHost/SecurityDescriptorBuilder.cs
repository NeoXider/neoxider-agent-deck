using System.Security.Principal;

namespace NeoXiderAgentDeck.BridgeHost;

internal static class SecurityDescriptorBuilder
{
    internal static string BuildPipeSddl(string appContainerSid, string currentUserSid)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(appContainerSid);
        ArgumentException.ThrowIfNullOrWhiteSpace(currentUserSid);
        _ = new SecurityIdentifier(appContainerSid);
        _ = new SecurityIdentifier(currentUserSid);
        return $"D:P(A;;GA;;;SY)(A;;GA;;;{currentUserSid})(A;;GA;;;{appContainerSid})";
    }
}
