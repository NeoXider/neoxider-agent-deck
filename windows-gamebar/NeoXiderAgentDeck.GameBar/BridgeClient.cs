using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace NeoXiderAgentDeck.GameBar
{
    internal enum BridgeConnectionStatus
    {
        Connecting,
        Connected,
        Disconnected,
    }

    internal sealed class BridgeConnectionChangedEventArgs : EventArgs
    {
        internal BridgeConnectionChangedEventArgs(BridgeConnectionStatus status)
        {
            Status = status;
        }

        internal BridgeConnectionStatus Status { get; }
    }

    internal sealed class BridgeCommandException : Exception
    {
        internal BridgeCommandException(string code, string message)
            : base(message)
        {
            Code = code;
        }

        internal string Code { get; }
    }

    internal sealed class BridgeClient : IDisposable
    {
        private sealed class PendingRequest
        {
            internal PendingRequest(int generation, IEnumerable<string> expectedTypes)
            {
                Generation = generation;
                ExpectedTypes = new HashSet<string>(expectedTypes, StringComparer.Ordinal);
                Completion = new TaskCompletionSource<BridgeServerFrame>(
                    TaskCreationOptions.RunContinuationsAsynchronously);
            }

            internal int Generation { get; }
            internal HashSet<string> ExpectedTypes { get; }
            internal TaskCompletionSource<BridgeServerFrame> Completion { get; }
        }

        internal const string PipeServer = ".";
        internal const string PipeName = @"LOCAL\NeoXider.AgentDeck.GameBar.v1";

        private const int ConnectTimeoutMilliseconds = 2500;
        private const int RequestTimeoutMilliseconds = 5000;
        private const int InitialReconnectDelayMilliseconds = 250;
        private const int MaximumReconnectDelayMilliseconds = 8000;

        private static readonly UTF8Encoding StrictUtf8 = new UTF8Encoding(false, true);
        private readonly object stateGate = new object();
        private readonly object pendingGate = new object();
        private readonly SemaphoreSlim writeGate = new SemaphoreSlim(1, 1);
        private readonly Dictionary<string, PendingRequest> pending =
            new Dictionary<string, PendingRequest>(StringComparer.Ordinal);

        private CancellationTokenSource lifetime;
        private Task worker;
        private NamedPipeClientStream activePipe;
        private int generation;
        private int connectionGeneration;
        private int nextConnectionGeneration;
        private bool connected;

        internal event EventHandler<BridgeConnectionChangedEventArgs> ConnectionChanged;
        internal event EventHandler<BridgeSnapshot> SnapshotReceived;

        internal bool IsConnected
        {
            get
            {
                lock (stateGate) return connected;
            }
        }

        internal void Start()
        {
            int currentGeneration;
            CancellationTokenSource source;
            lock (stateGate)
            {
                if (lifetime != null) return;
                source = new CancellationTokenSource();
                lifetime = source;
                currentGeneration = ++generation;
                worker = RunAsync(currentGeneration, source.Token);
            }
        }

        internal void Stop()
        {
            CancellationTokenSource source;
            Task stoppedWorker;
            NamedPipeClientStream pipe;
            int stoppedGeneration;
            bool wasActive;
            lock (stateGate)
            {
                source = lifetime;
                stoppedWorker = worker;
                pipe = activePipe;
                stoppedGeneration = connectionGeneration;
                wasActive = lifetime != null || connected;
                lifetime = null;
                worker = null;
                activePipe = null;
                connectionGeneration = 0;
                connected = false;
                generation++;
            }

            if (source != null) source.Cancel();
            if (pipe != null) pipe.Dispose();
            if (stoppedGeneration != 0)
            {
                FailPendingGeneration(
                    stoppedGeneration,
                    new OperationCanceledException("The bridge connection stopped."));
            }
            if (source != null)
            {
                if (stoppedWorker == null) source.Dispose();
                else _ = stoppedWorker.ContinueWith(
                    ignored => source.Dispose(),
                    CancellationToken.None,
                    TaskContinuationOptions.ExecuteSynchronously,
                    TaskScheduler.Default);
            }
            if (wasActive) RaiseConnectionChanged(BridgeConnectionStatus.Disconnected);
        }

        public void Dispose()
        {
            Stop();
        }

        internal async Task AcknowledgeAsync(string sessionId)
        {
            await SendCommandAsync("ack", sessionId, null).ConfigureAwait(false);
            await SendCommandAsync("request-snapshot", null, null).ConfigureAwait(false);
        }

        internal Task OpenSessionAsync(string sessionId)
        {
            return SendCommandAsync("open-session", sessionId, null);
        }

        internal Task QuickReplyAsync(string sessionId, string text)
        {
            return SendCommandAsync("quick-reply", sessionId, text);
        }

        private async Task RunAsync(int currentGeneration, CancellationToken cancellationToken)
        {
            int reconnectDelay = InitialReconnectDelayMilliseconds;
            while (!cancellationToken.IsCancellationRequested && IsCurrentGeneration(currentGeneration))
            {
                bool handshakeCompleted = false;
                try
                {
                    RaiseConnectionChanged(BridgeConnectionStatus.Connecting);
                    await ConnectAndPumpAsync(
                        currentGeneration,
                        cancellationToken,
                        () => handshakeCompleted = true).ConfigureAwait(false);
                }
                catch
                {
                    // Connection, protocol and command failures all take the same safe
                    // offline path. Raw exception details never cross into the widget UI.
                }
                if (cancellationToken.IsCancellationRequested || !IsCurrentGeneration(currentGeneration)) break;
                RaiseConnectionChanged(BridgeConnectionStatus.Disconnected);
                int delay = handshakeCompleted ? InitialReconnectDelayMilliseconds : reconnectDelay;
                reconnectDelay = handshakeCompleted
                    ? InitialReconnectDelayMilliseconds
                    : Math.Min(reconnectDelay * 2, MaximumReconnectDelayMilliseconds);
                try
                {
                    await Task.Delay(delay, cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }

        private async Task ConnectAndPumpAsync(
            int currentGeneration,
            CancellationToken cancellationToken,
            Action onHandshakeCompleted)
        {
            NamedPipeClientStream pipe = new NamedPipeClientStream(
                PipeServer,
                PipeName,
                PipeDirection.InOut,
                PipeOptions.Asynchronous);
            int currentConnectionGeneration = SetActivePipe(currentGeneration, pipe);
            Task reader = null;
            try
            {
                using (cancellationToken.Register(() => pipe.Dispose()))
                {
                    await pipe.ConnectAsync(ConnectTimeoutMilliseconds).ConfigureAwait(false);
                    cancellationToken.ThrowIfCancellationRequested();
                    reader = ReadLoopAsync(
                        pipe,
                        currentGeneration,
                        currentConnectionGeneration,
                        cancellationToken);

                    string helloRequestId = CreateRequestId();
                    await SendRequestAsync(
                        pipe,
                        BridgeProtocol.CreateHello(helloRequestId),
                        helloRequestId,
                        currentConnectionGeneration,
                        cancellationToken,
                        "hello.ok").ConfigureAwait(false);

                    if (!IsConnectedForGeneration(currentGeneration, currentConnectionGeneration))
                    {
                        throw new BridgeProtocolException("invalid-frame");
                    }
                    onHandshakeCompleted();

                    await SendCommandOnConnectionAsync(
                        pipe,
                        currentConnectionGeneration,
                        cancellationToken,
                        "request-snapshot",
                        null,
                        null).ConfigureAwait(false);
                    await reader.ConfigureAwait(false);
                }
            }
            finally
            {
                ClearActiveConnection(currentGeneration, currentConnectionGeneration, pipe);
                FailPendingGeneration(
                    currentConnectionGeneration,
                    new IOException("The bridge connection was lost."));
                if (reader != null)
                {
                    try
                    {
                        await reader.ConfigureAwait(false);
                    }
                    catch
                    {
                        // The connection failure is already handled by RunAsync.
                    }
                }
            }
        }

        private async Task ReadLoopAsync(
            NamedPipeClientStream pipe,
            int currentGeneration,
            int currentConnectionGeneration,
            CancellationToken cancellationToken)
        {
            try
            {
                await ReadLoopCoreAsync(
                    pipe,
                    currentGeneration,
                    currentConnectionGeneration,
                    cancellationToken).ConfigureAwait(false);
            }
            catch (Exception error)
            {
                FailPendingGeneration(currentConnectionGeneration, error);
                throw;
            }
        }

        private async Task ReadLoopCoreAsync(
            NamedPipeClientStream pipe,
            int currentGeneration,
            int currentConnectionGeneration,
            CancellationToken cancellationToken)
        {
            byte[] singleByte = new byte[1];
            using (MemoryStream frameBytes = new MemoryStream())
            {
                while (!cancellationToken.IsCancellationRequested)
                {
                    int read = await pipe.ReadAsync(singleByte, 0, 1, cancellationToken).ConfigureAwait(false);
                    if (read == 0) throw new EndOfStreamException("The bridge closed the pipe.");
                    byte value = singleByte[0];
                    if (value == 13) throw new BridgeProtocolException("invalid-frame");
                    frameBytes.WriteByte(value);
                    if (frameBytes.Length > BridgeProtocol.MaximumFrameBytes)
                    {
                        throw new BridgeProtocolException("oversized-frame");
                    }
                    if (value != 10) continue;

                    byte[] bytes = frameBytes.ToArray();
                    string json;
                    try
                    {
                        json = StrictUtf8.GetString(bytes, 0, bytes.Length - 1);
                    }
                    catch (DecoderFallbackException)
                    {
                        throw new BridgeProtocolException("malformed-json");
                    }
                    frameBytes.SetLength(0);
                    BridgeServerFrame frame = BridgeProtocol.ParseServerFrame(json);
                    ProcessFrame(frame, currentGeneration, currentConnectionGeneration);
                }
            }
        }

        private void ProcessFrame(
            BridgeServerFrame frame,
            int currentGeneration,
            int currentConnectionGeneration)
        {
            if (!IsActiveConnection(currentGeneration, currentConnectionGeneration)) return;
            if (frame.Type == "snapshot")
            {
                if (!IsConnectedForGeneration(currentGeneration, currentConnectionGeneration))
                {
                    throw new BridgeProtocolException("invalid-frame");
                }
                EventHandler<BridgeSnapshot> handler = SnapshotReceived;
                if (handler != null) handler(this, frame.Snapshot);
                return;
            }

            PendingRequest request;
            bool handshakeAccepted = false;
            lock (pendingGate)
            {
                if (!pending.TryGetValue(frame.RequestId, out request)
                    || request.Generation != currentConnectionGeneration
                    || !request.ExpectedTypes.Contains(frame.Type))
                {
                    throw new BridgeProtocolException("invalid-frame");
                }
                pending.Remove(frame.RequestId);
                if (frame.Type == "hello.ok")
                {
                    MarkConnected(currentGeneration, currentConnectionGeneration);
                    handshakeAccepted = true;
                }
            }
            if (handshakeAccepted)
            {
                RaiseConnectionChanged(BridgeConnectionStatus.Connected);
            }
            if (!request.Completion.TrySetResult(frame))
            {
                throw new BridgeProtocolException("invalid-frame");
            }
        }

        private async Task SendCommandAsync(string command, string sessionId, string text)
        {
            NamedPipeClientStream pipe;
            CancellationToken cancellationToken;
            int currentConnectionGeneration;
            lock (stateGate)
            {
                if (!connected || activePipe == null || lifetime == null)
                {
                    throw new InvalidOperationException("The Agent Deck bridge is offline.");
                }
                pipe = activePipe;
                cancellationToken = lifetime.Token;
                currentConnectionGeneration = connectionGeneration;
            }

            await SendCommandOnConnectionAsync(
                pipe,
                currentConnectionGeneration,
                cancellationToken,
                command,
                sessionId,
                text).ConfigureAwait(false);
        }

        private async Task SendCommandOnConnectionAsync(
            NamedPipeClientStream pipe,
            int currentConnectionGeneration,
            CancellationToken cancellationToken,
            string command,
            string sessionId,
            string text)
        {
            string requestId = CreateRequestId();
            BridgeServerFrame response = await SendRequestAsync(
                pipe,
                BridgeProtocol.CreateCommand(requestId, command, sessionId, text),
                requestId,
                currentConnectionGeneration,
                cancellationToken,
                "command.ok",
                "command.error").ConfigureAwait(false);
            if (response.Type == "command.error")
            {
                throw new BridgeCommandException(response.ErrorCode, response.ErrorMessage);
            }
            if (response.Type != "command.ok") throw new BridgeProtocolException("invalid-frame");
        }

        private async Task<BridgeServerFrame> SendRequestAsync(
            NamedPipeClientStream pipe,
            string json,
            string requestId,
            int currentConnectionGeneration,
            CancellationToken cancellationToken,
            params string[] expectedTypes)
        {
            PendingRequest request = RegisterPending(requestId, currentConnectionGeneration, expectedTypes);
            try
            {
                await WriteFrameAsync(pipe, json, cancellationToken).ConfigureAwait(false);
                Task timeout = Task.Delay(RequestTimeoutMilliseconds, cancellationToken);
                Task finished = await Task.WhenAny(request.Completion.Task, timeout).ConfigureAwait(false);
                if (finished != request.Completion.Task)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    throw new TimeoutException("The bridge did not answer the request.");
                }
                return await request.Completion.Task.ConfigureAwait(false);
            }
            finally
            {
                lock (pendingGate)
                {
                    PendingRequest current;
                    if (pending.TryGetValue(requestId, out current) && ReferenceEquals(current, request))
                    {
                        pending.Remove(requestId);
                    }
                }
            }
        }

        private async Task WriteFrameAsync(
            NamedPipeClientStream pipe,
            string json,
            CancellationToken cancellationToken)
        {
            byte[] bytes = StrictUtf8.GetBytes(json + "\n");
            if (bytes.Length > BridgeProtocol.MaximumFrameBytes)
            {
                throw new BridgeProtocolException("oversized-frame");
            }

            await writeGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                await pipe.WriteAsync(bytes, 0, bytes.Length, cancellationToken).ConfigureAwait(false);
                await pipe.FlushAsync(cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                writeGate.Release();
            }
        }

        private PendingRequest RegisterPending(
            string requestId,
            int currentConnectionGeneration,
            IEnumerable<string> expectedTypes)
        {
            lock (pendingGate)
            {
                if (pending.Count >= BridgeProtocol.MaximumPendingRequests)
                {
                    throw new InvalidOperationException("Too many bridge requests are pending.");
                }
                if (pending.ContainsKey(requestId)) throw new InvalidOperationException("Duplicate bridge request id.");
                PendingRequest request = new PendingRequest(currentConnectionGeneration, expectedTypes);
                if (request.ExpectedTypes.Count == 0) throw new ArgumentException("Expected response types are required.");
                pending.Add(requestId, request);
                return request;
            }
        }

        private void FailPendingGeneration(int currentConnectionGeneration, Exception error)
        {
            List<PendingRequest> requests = new List<PendingRequest>();
            lock (pendingGate)
            {
                List<string> requestIds = new List<string>();
                foreach (KeyValuePair<string, PendingRequest> pair in pending)
                {
                    if (pair.Value.Generation != currentConnectionGeneration) continue;
                    requestIds.Add(pair.Key);
                    requests.Add(pair.Value);
                }
                foreach (string requestId in requestIds) pending.Remove(requestId);
            }
            foreach (PendingRequest request in requests)
            {
                request.Completion.TrySetException(error);
            }
        }

        private int SetActivePipe(int currentGeneration, NamedPipeClientStream pipe)
        {
            lock (stateGate)
            {
                if (generation != currentGeneration || lifetime == null)
                {
                    pipe.Dispose();
                    throw new OperationCanceledException();
                }
                activePipe = pipe;
                connectionGeneration = ++nextConnectionGeneration;
                connected = false;
                return connectionGeneration;
            }
        }

        private void MarkConnected(int currentGeneration, int currentConnectionGeneration)
        {
            lock (stateGate)
            {
                if (generation != currentGeneration || connectionGeneration != currentConnectionGeneration
                    || lifetime == null)
                {
                    throw new OperationCanceledException();
                }
                connected = true;
            }
        }

        private void ClearActiveConnection(
            int currentGeneration,
            int currentConnectionGeneration,
            NamedPipeClientStream pipe)
        {
            lock (stateGate)
            {
                if (generation == currentGeneration
                    && connectionGeneration == currentConnectionGeneration
                    && ReferenceEquals(activePipe, pipe))
                {
                    activePipe = null;
                    connectionGeneration = 0;
                    connected = false;
                }
            }
            pipe.Dispose();
        }

        private bool IsCurrentGeneration(int currentGeneration)
        {
            lock (stateGate) return generation == currentGeneration && lifetime != null;
        }

        private bool IsActiveConnection(int currentGeneration, int currentConnectionGeneration)
        {
            lock (stateGate)
            {
                return generation == currentGeneration
                    && connectionGeneration == currentConnectionGeneration
                    && lifetime != null;
            }
        }

        private bool IsConnectedForGeneration(int currentGeneration, int currentConnectionGeneration)
        {
            lock (stateGate)
            {
                return generation == currentGeneration
                    && connectionGeneration == currentConnectionGeneration
                    && lifetime != null
                    && connected;
            }
        }

        private void RaiseConnectionChanged(BridgeConnectionStatus status)
        {
            EventHandler<BridgeConnectionChangedEventArgs> handler = ConnectionChanged;
            if (handler != null) handler(this, new BridgeConnectionChangedEventArgs(status));
        }

        private static string CreateRequestId()
        {
            return Guid.NewGuid().ToString("N");
        }
    }
}
