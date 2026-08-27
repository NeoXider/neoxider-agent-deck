namespace NeoXiderAgentDeck.BridgeHost;

internal sealed class BridgeStartupException : Exception
{
    internal BridgeStartupException(string message)
        : base(message)
    {
    }

    internal BridgeStartupException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
