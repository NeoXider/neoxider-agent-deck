namespace NeoXiderAgentDeck.BridgeHost;

internal static class BridgeConstants
{
    internal const string PackageIdentityName = "NeoXider.AgentDeck.GameBar";
    internal const string PackagePublisher = "CN=NeoXider";
    internal const string PipeName = @"LOCAL\NeoXider.AgentDeck.GameBar.v1";
    internal const string FullPipeName = @"\\.\pipe\LOCAL\NeoXider.AgentDeck.GameBar.v1";
    internal const int MaximumFrameBytes = 65_536;
    internal const int AuthenticationRejectDelayMilliseconds = 100;
}
