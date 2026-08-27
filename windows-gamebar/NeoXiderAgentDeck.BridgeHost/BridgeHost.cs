using System.IO.Pipes;
using System.Threading.Channels;

namespace NeoXiderAgentDeck.BridgeHost;

internal delegate bool PipeClientAuthenticator(
    NamedPipeServerStream pipe,
    SafeSidHandle expectedAppContainerSid,
    out string failure);

internal sealed class BridgeHost
{
    private readonly SafeSidHandle expectedAppContainerSid;
    private readonly Stream standardInput;
    private readonly Stream standardOutput;
    private readonly TextWriter diagnostics;
    private readonly Func<NamedPipeServerStream> createServer;
    private readonly PipeClientAuthenticator authenticateClient;

    internal BridgeHost(
        SafeSidHandle expectedAppContainerSid,
        string expectedSidText,
        Stream standardInput,
        Stream standardOutput,
        TextWriter diagnostics,
        Func<NamedPipeServerStream>? createServer = null,
        PipeClientAuthenticator? authenticateClient = null)
    {
        this.expectedAppContainerSid = expectedAppContainerSid;
        this.standardInput = standardInput;
        this.standardOutput = standardOutput;
        this.diagnostics = diagnostics;
        this.createServer = createServer ?? (() =>
            NativePipeSecurity.CreateServer(expectedAppContainerSid, expectedSidText));
        this.authenticateClient = authenticateClient ??
            NativePipeSecurity.AuthenticateConnectedClient;
    }

    internal async Task RunAsync(CancellationToken cancellationToken)
    {
        var desktopFrames = new DesktopFrameRouter();
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        Task inputPump = PumpStandardInputAsync(desktopFrames, lifetime);
        bool detachInputPump = false;

        try
        {
            bool authenticatedConnectionServed = await AcceptClientsAsync(
                desktopFrames,
                lifetime.Token).ConfigureAwait(false);

            if (authenticatedConnectionServed && !inputPump.IsCompleted)
            {
                detachInputPump = true;
                return;
            }
        }
        finally
        {
            lifetime.Cancel();
            if ((cancellationToken.IsCancellationRequested || detachInputPump) &&
                !inputPump.IsCompleted)
            {
                _ = inputPump.ContinueWith(
                    task => _ = task.Exception,
                    CancellationToken.None,
                    TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
                    TaskScheduler.Default);
            }
            else
            {
                await inputPump.ConfigureAwait(false);
            }
        }
    }

    private async Task PumpStandardInputAsync(
        DesktopFrameRouter desktopFrames,
        CancellationTokenSource lifetime)
    {
        var reader = new BoundedJsonLineReader(standardInput);
        try
        {
            while (!lifetime.IsCancellationRequested)
            {
                byte[]? frame = await reader
                    .ReadFrameAsync(lifetime.Token)
                    .ConfigureAwait(false);
                if (frame is null)
                {
                    lifetime.Cancel();
                    return;
                }

                DesktopFrameRouteResult route = desktopFrames.TryRoute(frame);
                if (route == DesktopFrameRouteResult.ActiveOverflow)
                {
                    await diagnostics.WriteLineAsync(
                        "desktop response queue overflowed; the active pipe generation was closed.").ConfigureAwait(false);
                }
            }
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            await diagnostics.WriteLineAsync($"stdin transport rejected: {exception.Message}").ConfigureAwait(false);
            lifetime.Cancel();
            throw;
        }
    }

    private async Task<bool> AcceptClientsAsync(
        DesktopFrameRouter desktopFrames,
        CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            bool authenticatedConnection = false;
            try
            {
                using NamedPipeServerStream pipe = await PipeCreationRetry.RunAsync(
                    createServer,
                    Task.Delay,
                    cancellationToken).ConfigureAwait(false);
                await pipe.WaitForConnectionAsync(cancellationToken).ConfigureAwait(false);

                if (!authenticateClient(
                        pipe,
                        expectedAppContainerSid,
                        out string failure))
                {
                    await diagnostics.WriteLineAsync($"pipe client rejected: {failure}").ConfigureAwait(false);
                    await Task.Delay(
                        BridgeConstants.AuthenticationRejectDelayMilliseconds,
                        cancellationToken).ConfigureAwait(false);
                    continue;
                }

                authenticatedConnection = true;
                DesktopFrameMailbox mailbox = desktopFrames.Activate();
                try
                {
                    try
                    {
                        await RelayConnectionAsync(
                            pipe,
                            mailbox.Reader,
                            mailbox.Aborted,
                            cancellationToken).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                    {
                        return false;
                    }
                    catch (OperationCanceledException) when (mailbox.Aborted.IsCancellationRequested)
                    {
                        await diagnostics.WriteLineAsync(
                            "authenticated pipe generation closed after desktop queue overflow.").ConfigureAwait(false);
                    }
                    catch (IOException exception)
                    {
                        await diagnostics.WriteLineAsync(
                            $"authenticated pipe disconnected: {exception.Message}").ConfigureAwait(false);
                    }
                    catch (BridgeFrameException exception)
                    {
                        await diagnostics.WriteLineAsync(
                            $"authenticated pipe rejected: {exception.Message}").ConfigureAwait(false);
                    }
                    catch (Exception exception)
                    {
                        await diagnostics.WriteLineAsync(
                            $"authenticated pipe failed: {exception.Message}").ConfigureAwait(false);
                    }
                }
                finally
                {
                    desktopFrames.Deactivate(mailbox);
                }

                return true;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return false;
            }
            catch (IOException exception) when (!authenticatedConnection)
            {
                await diagnostics.WriteLineAsync($"pipe disconnected: {exception.Message}").ConfigureAwait(false);
            }
            catch (BridgeFrameException exception) when (!authenticatedConnection)
            {
                await diagnostics.WriteLineAsync($"pipe transport rejected: {exception.Message}").ConfigureAwait(false);
            }
            catch (BridgeStartupException)
            {
                throw;
            }
            catch (Exception exception) when (!authenticatedConnection)
            {
                await diagnostics.WriteLineAsync($"pipe transport failed: {exception.Message}").ConfigureAwait(false);
                await Task.Delay(TimeSpan.FromMilliseconds(250), cancellationToken).ConfigureAwait(false);
            }
            catch
            {
                throw;
            }
        }

        return false;
    }

    private async Task RelayConnectionAsync(
        NamedPipeServerStream pipe,
        ChannelReader<byte[]> inboundFromDesktop,
        CancellationToken mailboxAborted,
        CancellationToken cancellationToken)
    {
        using var connection = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken,
            mailboxAborted);
        Task pipeToDesktop = RelayPipeToStandardOutputAsync(pipe, connection.Token);
        Task desktopToPipe = RelayStandardInputToPipeAsync(pipe, inboundFromDesktop, connection.Token);

        Task completed = await Task.WhenAny(pipeToDesktop, desktopToPipe).ConfigureAwait(false);
        Task sibling = completed == pipeToDesktop ? desktopToPipe : pipeToDesktop;
        connection.Cancel();
        try
        {
            await completed.ConfigureAwait(false);
        }
        finally
        {
            await IgnoreExpectedShutdownAsync(sibling).ConfigureAwait(false);
        }
    }

    private async Task RelayPipeToStandardOutputAsync(
        NamedPipeServerStream pipe,
        CancellationToken cancellationToken)
    {
        var reader = new BoundedJsonLineReader(pipe);
        while (!cancellationToken.IsCancellationRequested)
        {
            byte[]? frame = await reader
                .ReadFrameAsync(cancellationToken)
                .ConfigureAwait(false);
            if (frame is null)
            {
                return;
            }

            await standardOutput.WriteAsync(frame, cancellationToken).ConfigureAwait(false);
            await standardOutput.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    private static async Task RelayStandardInputToPipeAsync(
        NamedPipeServerStream pipe,
        ChannelReader<byte[]> inboundFromDesktop,
        CancellationToken cancellationToken)
    {
        await foreach (byte[] frame in inboundFromDesktop.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            StrictJsonLineCodec.ValidateFrame(frame);
            await pipe.WriteAsync(frame, cancellationToken).ConfigureAwait(false);
            await pipe.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    private static async Task IgnoreExpectedShutdownAsync(Task task)
    {
        try
        {
            await task.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }
        catch (IOException)
        {
        }
        catch (ChannelClosedException)
        {
        }
    }
}
