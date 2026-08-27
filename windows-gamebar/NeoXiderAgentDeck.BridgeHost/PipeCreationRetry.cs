using System.ComponentModel;

namespace NeoXiderAgentDeck.BridgeHost;

internal static class PipeCreationRetry
{
    internal const int MaximumAttempts = 5;

    internal static async Task<T> RunAsync<T>(
        Func<T> create,
        Func<TimeSpan, CancellationToken, Task> delay,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(create);
        ArgumentNullException.ThrowIfNull(delay);

        Win32Exception? lastFailure = null;
        for (int attempt = 1; attempt <= MaximumAttempts; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                return create();
            }
            catch (Win32Exception exception)
            {
                lastFailure = exception;
                if (attempt == MaximumAttempts)
                {
                    break;
                }

                int delayMilliseconds = 100 << (attempt - 1);
                await delay(TimeSpan.FromMilliseconds(delayMilliseconds), cancellationToken)
                    .ConfigureAwait(false);
            }
        }

        throw new BridgeStartupException(
            $"The protected pipe namespace could not be acquired after {MaximumAttempts} attempts.",
            lastFailure!);
    }
}
