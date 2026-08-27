using System.Threading.Channels;

namespace NeoXiderAgentDeck.BridgeHost;

internal sealed class DesktopFrameMailbox
{
    private readonly Channel<byte[]> channel = Channel.CreateBounded<byte[]>(
        new BoundedChannelOptions(16)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = true,
            AllowSynchronousContinuations = false,
        });
    private readonly CancellationTokenSource aborted = new();

    internal ChannelReader<byte[]> Reader => channel.Reader;
    internal CancellationToken Aborted => aborted.Token;

    internal bool TryWrite(byte[] frame) => channel.Writer.TryWrite(frame);

    internal void Complete() => channel.Writer.TryComplete();

    internal void Abort()
    {
        channel.Writer.TryComplete(new BridgeFrameException(
            "The active desktop response queue exceeded 16 frames."));
        aborted.Cancel();
    }
}

internal enum DesktopFrameRouteResult
{
    Disconnected,
    Routed,
    ActiveOverflow,
}

internal sealed class DesktopFrameRouter
{
    private readonly object gate = new();
    private DesktopFrameMailbox? active;
    private bool activated;

    internal DesktopFrameMailbox Activate()
    {
        lock (gate)
        {
            if (active is not null || activated)
            {
                throw new InvalidOperationException(
                    "This bridge-host lifetime already served an authenticated pipe generation.");
            }

            activated = true;
            active = new DesktopFrameMailbox();
            return active;
        }
    }

    internal void Deactivate(DesktopFrameMailbox mailbox)
    {
        ArgumentNullException.ThrowIfNull(mailbox);
        lock (gate)
        {
            if (!ReferenceEquals(active, mailbox))
            {
                return;
            }

            active = null;
            mailbox.Complete();
        }
    }

    internal DesktopFrameRouteResult TryRoute(byte[] frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        lock (gate)
        {
            if (active is null)
            {
                return DesktopFrameRouteResult.Disconnected;
            }

            if (active.TryWrite(frame))
            {
                return DesktopFrameRouteResult.Routed;
            }

            DesktopFrameMailbox overflowed = active;
            active = null;
            overflowed.Abort();
            return DesktopFrameRouteResult.ActiveOverflow;
        }
    }
}
