using NeoXiderAgentDeck.BridgeHost;
using System.ComponentModel;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;

internal static class Program
{
    private static readonly List<(string Name, Func<Task> Run)> Tests =
    [
        ("valid JSON object frame", ValidFrameAsync),
        ("two sequential frames", SequentialFramesAsync),
        ("exact maximum frame", ExactMaximumFrameAsync),
        ("oversize frame", OversizeFrameAsync),
        ("invalid UTF-8", InvalidUtf8Async),
        ("UTF-8 BOM", Utf8BomAsync),
        ("raw carriage return", RawCarriageReturnAsync),
        ("unterminated frame", UnterminatedFrameAsync),
        ("non-object JSON", NonObjectJsonAsync),
        ("package selection", PackageSelectionAsync),
        ("ambiguous package families", AmbiguousPackageAsync),
        ("missing package", MissingPackageAsync),
        ("security descriptor", SecurityDescriptorAsync),
        ("pipe creation retry is bounded", PipeCreationRetryIsBoundedAsync),
        ("pipe creation retry recovers", PipeCreationRetryRecoversAsync),
        ("desktop frames drop after retired connection", DesktopFramesAreIsolatedAsync),
        ("authenticated connection retires host lifetime", AuthenticatedConnectionRetiresHostAsync),
        ("first pipe instance owns namespace", FirstPipeInstanceOwnsNamespaceAsync),
        ("desktop client authentication rejection", DesktopClientRejectedAsync),
        ("host exits on stdin EOF", HostExitsOnEofAsync),
        ("host rejects invalid stdin", HostRejectsInvalidInputAsync),
        ("host cancellation does not wait on stdin", HostCancellationAsync),
    ];

    private static async Task<int> Main()
    {
        int failures = 0;
        foreach ((string name, Func<Task> run) in Tests)
        {
            try
            {
                await run().ConfigureAwait(false);
                Console.WriteLine($"PASS {name}");
            }
            catch (Exception exception)
            {
                failures++;
                Console.Error.WriteLine($"FAIL {name}: {exception}");
            }
        }

        Console.WriteLine($"{Tests.Count - failures}/{Tests.Count} bridge-host tests passed");
        return failures == 0 ? 0 : 1;
    }

    private static async Task ValidFrameAsync()
    {
        byte[] expected = Encoding.UTF8.GetBytes("{\"v\":1}\n");
        using var stream = new MemoryStream(expected);
        var reader = new BoundedJsonLineReader(stream);
        byte[]? actual = await reader.ReadFrameAsync(CancellationToken.None);
        Equal(expected, actual!);
        Null(await reader.ReadFrameAsync(CancellationToken.None));
    }

    private static async Task SequentialFramesAsync()
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("{\"a\":1}\n{\"b\":2}\n"));
        var reader = new BoundedJsonLineReader(stream);
        Equal("{\"a\":1}\n", Utf8(await reader.ReadFrameAsync(CancellationToken.None)));
        Equal("{\"b\":2}\n", Utf8(await reader.ReadFrameAsync(CancellationToken.None)));
    }

    private static async Task ExactMaximumFrameAsync()
    {
        string frame = "{\"x\":\"" + new string('a', BridgeConstants.MaximumFrameBytes - 9) + "\"}\n";
        Equal(BridgeConstants.MaximumFrameBytes, Encoding.UTF8.GetByteCount(frame));
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(frame));
        byte[]? actual = await new BoundedJsonLineReader(stream).ReadFrameAsync(CancellationToken.None);
        Equal(BridgeConstants.MaximumFrameBytes, actual!.Length);
    }

    private static async Task OversizeFrameAsync()
    {
        string frame = "{\"x\":\"" + new string('a', BridgeConstants.MaximumFrameBytes - 8) + "\"}\n";
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(frame));
        await ThrowsAsync<BridgeFrameException>(() =>
            new BoundedJsonLineReader(stream).ReadFrameAsync(CancellationToken.None).AsTask());
    }

    private static async Task InvalidUtf8Async()
    {
        using var stream = new MemoryStream([0x7B, 0x22, 0x78, 0x22, 0x3A, 0x22, 0xFF, 0x22, 0x7D, 0x0A]);
        await ThrowsAsync<BridgeFrameException>(() =>
            new BoundedJsonLineReader(stream).ReadFrameAsync(CancellationToken.None).AsTask());
    }

    private static async Task Utf8BomAsync()
    {
        byte[] json = Encoding.UTF8.GetBytes("{\"x\":1}\n");
        byte[] frame = [0xEF, 0xBB, 0xBF, .. json];
        using var stream = new MemoryStream(frame);
        await ThrowsAsync<BridgeFrameException>(() =>
            new BoundedJsonLineReader(stream).ReadFrameAsync(CancellationToken.None).AsTask());
    }

    private static async Task RawCarriageReturnAsync()
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("{\"x\":1}\r\n"));
        await ThrowsAsync<BridgeFrameException>(() =>
            new BoundedJsonLineReader(stream).ReadFrameAsync(CancellationToken.None).AsTask());
    }

    private static async Task UnterminatedFrameAsync()
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("{\"x\":1}"));
        await ThrowsAsync<BridgeFrameException>(() =>
            new BoundedJsonLineReader(stream).ReadFrameAsync(CancellationToken.None).AsTask());
    }

    private static async Task NonObjectJsonAsync()
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("[]\n"));
        await ThrowsAsync<BridgeFrameException>(() =>
            new BoundedJsonLineReader(stream).ReadFrameAsync(CancellationToken.None).AsTask());
    }

    private static Task PackageSelectionAsync()
    {
        PackageIdentityCandidate selected = PackageIdentitySelection.Select(
        [
            new("Other", "CN=NeoXider", "Other_family", 100),
            new(BridgeConstants.PackageIdentityName, BridgeConstants.PackagePublisher, "family", 1),
            new(BridgeConstants.PackageIdentityName, BridgeConstants.PackagePublisher, "family", 2),
        ],
        BridgeConstants.PackageIdentityName,
        BridgeConstants.PackagePublisher);
        Equal<ulong>(2, selected.Version);
        Equal("family", selected.FamilyName);
        return Task.CompletedTask;
    }

    private static Task AmbiguousPackageAsync()
    {
        Throws<BridgeStartupException>(() => PackageIdentitySelection.Select(
        [
            new(BridgeConstants.PackageIdentityName, BridgeConstants.PackagePublisher, "family-a", 1),
            new(BridgeConstants.PackageIdentityName, BridgeConstants.PackagePublisher, "family-b", 2),
        ],
        BridgeConstants.PackageIdentityName,
        BridgeConstants.PackagePublisher));
        return Task.CompletedTask;
    }

    private static Task MissingPackageAsync()
    {
        Throws<BridgeStartupException>(() => PackageIdentitySelection.Select(
            [],
            BridgeConstants.PackageIdentityName,
            BridgeConstants.PackagePublisher));
        return Task.CompletedTask;
    }

    private static Task SecurityDescriptorAsync()
    {
        const string appContainerSid = "S-1-15-2-1";
        const string currentUserSid = "S-1-5-21-100-200-300-1000";
        string sddl = SecurityDescriptorBuilder.BuildPipeSddl(appContainerSid, currentUserSid);
        True(sddl.Contains(";;;SY)", StringComparison.Ordinal));
        True(sddl.Contains(currentUserSid, StringComparison.Ordinal));
        True(sddl.Contains(appContainerSid, StringComparison.Ordinal));
        False(sddl.Contains(";;;WD)", StringComparison.Ordinal));
        Equal<uint>(0x00080000, NativeMethods.FileFlagFirstPipeInstance);
        _ = new SecurityIdentifier(appContainerSid);
        Throws<ArgumentException>(() =>
            SecurityDescriptorBuilder.BuildPipeSddl("not-a-sid", currentUserSid));
        return Task.CompletedTask;
    }

    private static async Task PipeCreationRetryIsBoundedAsync()
    {
        int attempts = 0;
        BridgeStartupException failure = await ThrowsAsync<BridgeStartupException>(() =>
            PipeCreationRetry.RunAsync<object>(
                () =>
                {
                    attempts++;
                    throw new Win32Exception(5);
                },
                (_, _) => Task.CompletedTask,
                CancellationToken.None));

        Equal(PipeCreationRetry.MaximumAttempts, attempts);
        True(failure.Message.Contains("protected pipe namespace", StringComparison.Ordinal));
        True(failure.InnerException is Win32Exception);
    }

    private static async Task PipeCreationRetryRecoversAsync()
    {
        int attempts = 0;
        object expected = new();
        object actual = await PipeCreationRetry.RunAsync(
            () =>
            {
                attempts++;
                if (attempts < 3)
                {
                    throw new Win32Exception(231);
                }

                return expected;
            },
            (_, _) => Task.CompletedTask,
            CancellationToken.None);

        Equal(3, attempts);
        True(ReferenceEquals(expected, actual));
    }

    private static Task DesktopFramesAreIsolatedAsync()
    {
        var router = new DesktopFrameRouter();
        byte[] beforeConnection = Encoding.UTF8.GetBytes("{\"generation\":0}\n");
        Equal(DesktopFrameRouteResult.Disconnected, router.TryRoute(beforeConnection));

        DesktopFrameMailbox first = router.Activate();
        byte[] firstFrame = Encoding.UTF8.GetBytes("{\"generation\":1}\n");
        Equal(DesktopFrameRouteResult.Routed, router.TryRoute(firstFrame));
        router.Deactivate(first);
        byte[] disconnectedFrame = Encoding.UTF8.GetBytes("{\"generation\":99}\n");
        Equal(DesktopFrameRouteResult.Disconnected, router.TryRoute(disconnectedFrame));

        True(first.Reader.TryRead(out byte[]? routedFirst));
        Equal(firstFrame, routedFirst!);
        False(first.Reader.TryRead(out _));
        Throws<InvalidOperationException>(() => router.Activate());

        var overflowRouter = new DesktopFrameRouter();
        DesktopFrameMailbox overflowed = overflowRouter.Activate();
        for (int index = 0; index < 16; index++)
        {
            Equal(DesktopFrameRouteResult.Routed, overflowRouter.TryRoute(
                Encoding.UTF8.GetBytes($"{{\"index\":{index}}}\n")));
        }

        Equal(DesktopFrameRouteResult.ActiveOverflow, overflowRouter.TryRoute(
            Encoding.UTF8.GetBytes("{\"index\":16}\n")));
        True(overflowed.Aborted.IsCancellationRequested);
        Equal(DesktopFrameRouteResult.Disconnected, overflowRouter.TryRoute(
            Encoding.UTF8.GetBytes("{\"index\":17}\n")));
        Throws<InvalidOperationException>(() => overflowRouter.Activate());
        return Task.CompletedTask;
    }

    private static async Task AuthenticatedConnectionRetiresHostAsync()
    {
        string pipeName = $"NeoXider.AgentDeck.BridgeHost.Tests.{Guid.NewGuid():N}";
        int serverCreations = 0;
        int authentications = 0;
        var serverReady = new TaskCompletionSource(
            TaskCreationOptions.RunContinuationsAsynchronously);

        using SafeSidHandle expectedSid = NativePipeSecurity.DeriveAppContainerSid(
            "NeoXider.AgentDeck.GameBar_lifetime_test");
        string sidText = NativePipeSecurity.GetSidString(expectedSid);
        using var input = new NonCancelableReadStream();
        using var output = new MemoryStream();
        using var diagnostics = new StringWriter();
        var host = new BridgeHost(
            expectedSid,
            sidText,
            input,
            output,
            diagnostics,
            createServer: () =>
            {
                Interlocked.Increment(ref serverCreations);
                var server = new NamedPipeServerStream(
                    pipeName,
                    PipeDirection.InOut,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous);
                serverReady.TrySetResult();
                return server;
            },
            authenticateClient: AcceptClient);

        Task run = host.RunAsync(CancellationToken.None);
        await serverReady.Task.WaitAsync(TimeSpan.FromSeconds(2));

        using (var client = new NamedPipeClientStream(
            ".",
            pipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous))
        {
            await client.ConnectAsync(2_000);
            byte[] frame = Encoding.UTF8.GetBytes("{\"v\":1,\"type\":\"hello\"}\n");
            await client.WriteAsync(frame);
            await client.FlushAsync();
        }

        await run.WaitAsync(TimeSpan.FromSeconds(2));
        Equal(1, serverCreations);
        Equal(1, authentications);
        Equal("{\"v\":1,\"type\":\"hello\"}\n", Encoding.UTF8.GetString(output.ToArray()));

        bool AcceptClient(
            NamedPipeServerStream _,
            SafeSidHandle __,
            out string failure)
        {
            Interlocked.Increment(ref authentications);
            failure = string.Empty;
            return true;
        }
    }

    private static async Task DesktopClientRejectedAsync()
    {
        using SafeSidHandle expectedSid = NativePipeSecurity.DeriveAppContainerSid(
            "NeoXider.AgentDeck.GameBar_test");
        string sidText = NativePipeSecurity.GetSidString(expectedSid);
        using NamedPipeServerStream server = NativePipeSecurity.CreateServer(expectedSid, sidText);
        using var client = new NamedPipeClientStream(
            ".",
            BridgeConstants.PipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous);

        Task waiting = server.WaitForConnectionAsync();
        await client.ConnectAsync(2_000);
        await waiting;

        bool accepted = NativePipeSecurity.AuthenticateConnectedClient(server, expectedSid, out string failure);
        False(accepted);
        True(!string.IsNullOrWhiteSpace(failure));
    }

    private static Task FirstPipeInstanceOwnsNamespaceAsync()
    {
        using SafeSidHandle expectedSid = NativePipeSecurity.DeriveAppContainerSid(
            "NeoXider.AgentDeck.GameBar_namespace_test");
        string sidText = NativePipeSecurity.GetSidString(expectedSid);
        using NamedPipeServerStream first = NativePipeSecurity.CreateServer(expectedSid, sidText);

        Throws<Win32Exception>(() =>
        {
            using NamedPipeServerStream second = NativePipeSecurity.CreateServer(expectedSid, sidText);
        });
        return Task.CompletedTask;
    }

    private static async Task HostExitsOnEofAsync()
    {
        using SafeSidHandle expectedSid = NativePipeSecurity.DeriveAppContainerSid(
            "NeoXider.AgentDeck.GameBar_eof_test");
        string sidText = NativePipeSecurity.GetSidString(expectedSid);
        using var input = new MemoryStream();
        using var output = new MemoryStream();
        using var diagnostics = new StringWriter();
        var host = new BridgeHost(expectedSid, sidText, input, output, diagnostics);

        await host.RunAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(2));
        Equal(0L, output.Length);
    }

    private static async Task HostRejectsInvalidInputAsync()
    {
        using SafeSidHandle expectedSid = NativePipeSecurity.DeriveAppContainerSid(
            "NeoXider.AgentDeck.GameBar_invalid_test");
        string sidText = NativePipeSecurity.GetSidString(expectedSid);
        using var input = new MemoryStream(Encoding.UTF8.GetBytes("not-json\n"));
        using var output = new MemoryStream();
        using var diagnostics = new StringWriter();
        var host = new BridgeHost(expectedSid, sidText, input, output, diagnostics);

        await ThrowsAsync<BridgeFrameException>(() =>
            host.RunAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(2)));
        Equal(0L, output.Length);
        True(diagnostics.ToString().Contains("stdin transport rejected", StringComparison.Ordinal));
    }

    private static async Task HostCancellationAsync()
    {
        using SafeSidHandle expectedSid = NativePipeSecurity.DeriveAppContainerSid(
            "NeoXider.AgentDeck.GameBar_cancel_test");
        string sidText = NativePipeSecurity.GetSidString(expectedSid);
        using var input = new NonCancelableReadStream();
        using var output = new MemoryStream();
        using var diagnostics = new StringWriter();
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
        var host = new BridgeHost(expectedSid, sidText, input, output, diagnostics);

        await host.RunAsync(cancellation.Token).WaitAsync(TimeSpan.FromSeconds(2));
        Equal(0L, output.Length);
    }

    private static string Utf8(byte[]? bytes) => Encoding.UTF8.GetString(bytes!);

    private static void Equal<T>(T expected, T actual)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException($"Expected '{expected}', got '{actual}'.");
        }
    }

    private static void Equal(byte[] expected, byte[] actual)
    {
        if (!expected.AsSpan().SequenceEqual(actual))
        {
            throw new InvalidOperationException("Byte sequences differ.");
        }
    }

    private static void True(bool value)
    {
        if (!value) throw new InvalidOperationException("Expected true.");
    }

    private static void False(bool value)
    {
        if (value) throw new InvalidOperationException("Expected false.");
    }

    private static void Null(object? value)
    {
        if (value is not null) throw new InvalidOperationException("Expected null.");
    }

    private static T Throws<T>(Action action) where T : Exception
    {
        try
        {
            action();
        }
        catch (T exception)
        {
            return exception;
        }

        throw new InvalidOperationException($"Expected {typeof(T).Name}.");
    }

    private static async Task<T> ThrowsAsync<T>(Func<Task> action) where T : Exception
    {
        try
        {
            await action().ConfigureAwait(false);
        }
        catch (T exception)
        {
            return exception;
        }

        throw new InvalidOperationException($"Expected {typeof(T).Name}.");
    }

    private sealed class NonCancelableReadStream : Stream
    {
        private readonly TaskCompletionSource<int> pending = new(
            TaskCreationOptions.RunContinuationsAsynchronously);

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override void Flush()
        {
        }

        public override int Read(byte[] buffer, int offset, int count) =>
            throw new NotSupportedException();

        public override ValueTask<int> ReadAsync(
            Memory<byte> buffer,
            CancellationToken cancellationToken = default) =>
            new(pending.Task);

        public override long Seek(long offset, SeekOrigin origin) =>
            throw new NotSupportedException();

        public override void SetLength(long value) =>
            throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) =>
            throw new NotSupportedException();
    }
}
