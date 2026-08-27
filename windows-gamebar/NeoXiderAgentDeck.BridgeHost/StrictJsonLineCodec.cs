using System.Text;
using System.Text.Json;

namespace NeoXiderAgentDeck.BridgeHost;

internal sealed class BridgeFrameException : Exception
{
    internal BridgeFrameException(string message)
        : base(message)
    {
    }

    internal BridgeFrameException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}

internal sealed class BoundedJsonLineReader
{
    private const int ReadBufferSize = 4096;
    private readonly Stream stream;
    private readonly byte[] readBuffer = new byte[ReadBufferSize];
    private readonly byte[] frameBuffer = new byte[BridgeConstants.MaximumFrameBytes];
    private int readOffset;
    private int readCount;
    private int frameLength;

    internal BoundedJsonLineReader(Stream stream)
    {
        ArgumentNullException.ThrowIfNull(stream);
        this.stream = stream;
    }

    internal async ValueTask<byte[]?> ReadFrameAsync(CancellationToken cancellationToken)
    {
        while (true)
        {
            if (readCount == 0)
            {
                readOffset = 0;
                readCount = await stream.ReadAsync(readBuffer, cancellationToken).ConfigureAwait(false);
                if (readCount == 0)
                {
                    if (frameLength == 0)
                    {
                        return null;
                    }

                    throw new BridgeFrameException("A JSONL frame ended before its newline delimiter.");
                }
            }

            ReadOnlySpan<byte> available = readBuffer.AsSpan(readOffset, readCount);
            int delimiterOffset = available.IndexOf((byte)'\n');
            int bytesBeforeDelimiter = delimiterOffset >= 0 ? delimiterOffset : available.Length;
            int requiredLength = frameLength + bytesBeforeDelimiter + (delimiterOffset >= 0 ? 1 : 0);
            if (requiredLength > BridgeConstants.MaximumFrameBytes ||
                (delimiterOffset < 0 && requiredLength == BridgeConstants.MaximumFrameBytes))
            {
                throw new BridgeFrameException(
                    $"A JSONL frame exceeded the {BridgeConstants.MaximumFrameBytes}-byte limit.");
            }

            available[..bytesBeforeDelimiter].CopyTo(frameBuffer.AsSpan(frameLength));
            frameLength += bytesBeforeDelimiter;
            readOffset += bytesBeforeDelimiter;
            readCount -= bytesBeforeDelimiter;

            if (delimiterOffset < 0)
            {
                continue;
            }

            frameBuffer[frameLength++] = (byte)'\n';
            readOffset++;
            readCount--;

            byte[] frame = frameBuffer.AsSpan(0, frameLength).ToArray();
            frameLength = 0;
            StrictJsonLineCodec.ValidateFrame(frame);
            return frame;
        }
    }
}

internal static class StrictJsonLineCodec
{
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    internal static void ValidateFrame(ReadOnlySpan<byte> frame)
    {
        if (frame.Length == 0 || frame[^1] != (byte)'\n')
        {
            throw new BridgeFrameException("A JSONL frame must end with one newline delimiter.");
        }

        if (frame.Length > BridgeConstants.MaximumFrameBytes)
        {
            throw new BridgeFrameException(
                $"A JSONL frame exceeded the {BridgeConstants.MaximumFrameBytes}-byte limit.");
        }

        ValidatePayload(frame[..^1]);
    }

    private static void ValidatePayload(ReadOnlySpan<byte> payload)
    {
        if (payload.Length == 0)
        {
            throw new BridgeFrameException("An empty JSONL frame is not allowed.");
        }

        if (payload.Contains((byte)'\r') || payload.Contains((byte)'\n'))
        {
            throw new BridgeFrameException("Raw multiline JSON is not allowed in the JSONL transport.");
        }

        string json;
        try
        {
            json = StrictUtf8.GetString(payload);
        }
        catch (DecoderFallbackException exception)
        {
            throw new BridgeFrameException("A JSONL frame was not valid UTF-8.", exception);
        }

        if (json.Length > 0 && json[0] == '\uFEFF')
        {
            throw new BridgeFrameException("A UTF-8 BOM is not allowed in a JSONL frame.");
        }

        try
        {
            using JsonDocument document = JsonDocument.Parse(json, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 32,
            });

            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                throw new BridgeFrameException("A JSONL frame must contain one JSON object.");
            }
        }
        catch (JsonException exception)
        {
            throw new BridgeFrameException("A JSONL frame did not contain one valid JSON object.", exception);
        }
    }
}
