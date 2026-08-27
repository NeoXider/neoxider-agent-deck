using System.Runtime.Loader;

namespace NeoXiderAgentDeck.BridgeHost;

internal static class Program
{
    internal static async Task<int> Main()
    {
        var cancellation = new CancellationTokenSource();

        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            cancellation.Cancel();
        };
        AssemblyLoadContext.Default.Unloading += _ => cancellation.Cancel();

        try
        {
            PackageIdentityCandidate package = new PackageIdentityResolver().Resolve();
            using SafeSidHandle expectedSid = NativePipeSecurity.DeriveAppContainerSid(package.FamilyName);
            string expectedSidText = NativePipeSecurity.GetSidString(expectedSid);

            var host = new BridgeHost(
                expectedSid,
                expectedSidText,
                Console.OpenStandardInput(),
                Console.OpenStandardOutput(),
                Console.Error);

            await host.RunAsync(cancellation.Token).ConfigureAwait(false);
            return 0;
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
        {
            return 0;
        }
        catch (BridgeStartupException exception)
        {
            await Console.Error.WriteLineAsync($"bridge startup refused: {exception.Message}").ConfigureAwait(false);
            return 3;
        }
        catch (Exception exception)
        {
            await Console.Error.WriteLineAsync($"bridge host failed: {exception.Message}").ConfigureAwait(false);
            return 1;
        }
    }
}
