using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using Windows.Data.Json;

namespace NeoXiderAgentDeck.GameBar
{
    internal sealed class BridgeProtocolException : Exception
    {
        internal BridgeProtocolException(string code)
            : base(PublicMessage(code))
        {
            Code = code;
        }

        internal string Code { get; }

        private static string PublicMessage(string code)
        {
            switch (code)
            {
                case "malformed-json": return "The bridge sent invalid JSON.";
                case "oversized-frame": return "The bridge frame exceeded the size limit.";
                case "unsupported-version": return "The bridge protocol version is not supported.";
                case "unknown-type": return "The bridge frame type is not supported.";
                case "unknown-status": return "The bridge status is not supported.";
                default: return "The bridge frame is invalid.";
            }
        }
    }

    internal sealed class BridgeSnapshot
    {
        internal long Revision { get; set; }
        internal string Status { get; set; }
        internal string SessionId { get; set; }
        internal string SessionTitle { get; set; }
        internal string Detail { get; set; }
        internal double ContextPercent { get; set; }
        internal bool Unread { get; set; }
        internal DateTimeOffset UpdatedAt { get; set; }
    }

    internal sealed class BridgeServerFrame
    {
        internal string Type { get; set; }
        internal string RequestId { get; set; }
        internal BridgeSnapshot Snapshot { get; set; }
        internal string ErrorCode { get; set; }
        internal string ErrorMessage { get; set; }
    }

    internal static class BridgeProtocol
    {
        internal const int Version = 1;
        internal const int MaximumFrameBytes = 65536;
        internal const int MaximumPendingRequests = 16;
        internal const int MaximumQuickReplyCharacters = 4000;

        private const int MaximumRequestIdCharacters = 64;
        private const int MaximumSessionIdCharacters = 256;
        private static readonly HashSet<string> Statuses = new HashSet<string>(StringComparer.Ordinal)
        {
            "idle", "thinking", "writing", "tool", "waiting", "done", "error", "offline",
        };
        private static readonly HashSet<string> Capabilities = new HashSet<string>(StringComparer.Ordinal)
        {
            "snapshot", "ack", "open-session", "quick-reply",
        };
        private static readonly Regex RequestIdPattern = new Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$");
        private static readonly Regex CodePattern = new Regex("^[a-z][a-z0-9-]{0,63}$");
        private static readonly Regex UtcTimestampPattern = new Regex(
            "^(?!0000)\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$",
            RegexOptions.CultureInvariant);

        internal static string CreateHello(string requestId)
        {
            RequireRequestId(requestId);
            JsonObject value = NewFrame("hello");
            value["client"] = JsonValue.CreateStringValue("gamebar");
            value["requestId"] = JsonValue.CreateStringValue(requestId);
            return value.Stringify();
        }

        internal static string CreateCommand(string requestId, string command, string sessionId = null, string text = null)
        {
            RequireRequestId(requestId);
            JsonObject value = NewFrame("command");
            value["requestId"] = JsonValue.CreateStringValue(requestId);
            value["command"] = JsonValue.CreateStringValue(command ?? string.Empty);

            switch (command)
            {
                case "request-snapshot":
                    if (sessionId != null || text != null) throw InvalidFrame();
                    break;
                case "ack":
                case "open-session":
                    RequireSessionId(sessionId);
                    if (text != null) throw InvalidFrame();
                    value["sessionId"] = JsonValue.CreateStringValue(sessionId);
                    break;
                case "quick-reply":
                    RequireSessionId(sessionId);
                    RequireString(text, 1, MaximumQuickReplyCharacters, true);
                    if (IsBlankQuickReply(text)) throw InvalidFrame();
                    value["sessionId"] = JsonValue.CreateStringValue(sessionId);
                    value["text"] = JsonValue.CreateStringValue(text);
                    break;
                default:
                    throw new BridgeProtocolException("unknown-type");
            }

            return value.Stringify();
        }

        internal static BridgeServerFrame ParseServerFrame(string json)
        {
            JsonObject value;
            try
            {
                value = JsonObject.Parse(json);
            }
            catch
            {
                throw new BridgeProtocolException("malformed-json");
            }

            RequireVersion(value);
            string type = GetString(value, "type", 1, 32);
            switch (type)
            {
                case "hello.ok": return ParseHelloOk(value);
                case "snapshot": return ParseSnapshot(value);
                case "command.ok": return ParseCommandOk(value);
                case "command.error": return ParseCommandError(value);
                default: throw new BridgeProtocolException("unknown-type");
            }
        }

        private static BridgeServerFrame ParseHelloOk(JsonObject value)
        {
            RequireKeys(value, "v", "type", "requestId", "serverVersion", "capabilities");
            string requestId = GetRequestId(value);
            string serverVersion = GetString(value, "serverVersion", 1, 64);
            if (!Regex.IsMatch(serverVersion, "^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$")) throw InvalidFrame();

            JsonArray capabilities = GetArray(value, "capabilities");
            if (capabilities.Count != Capabilities.Count) throw InvalidFrame();
            HashSet<string> unique = new HashSet<string>(StringComparer.Ordinal);
            foreach (IJsonValue item in capabilities)
            {
                if (item.ValueType != JsonValueType.String) throw InvalidFrame();
                string capability = item.GetString();
                if (!Capabilities.Contains(capability) || !unique.Add(capability)) throw InvalidFrame();
            }

            return new BridgeServerFrame { Type = "hello.ok", RequestId = requestId };
        }

        private static BridgeServerFrame ParseSnapshot(JsonObject value)
        {
            RequireKeys(value, "v", "type", "revision", "status", "sessionId", "sessionTitle", "detail",
                "contextPercent", "unread", "updatedAt");
            double revisionValue = GetNumber(value, "revision");
            if (revisionValue < 0 || revisionValue > 9007199254740991d || revisionValue != Math.Truncate(revisionValue))
            {
                throw InvalidFrame();
            }

            string status = GetString(value, "status", 1, 16);
            if (!Statuses.Contains(status)) throw new BridgeProtocolException("unknown-status");
            string updatedAtValue = GetString(value, "updatedAt", 20, 24);
            DateTimeOffset updatedAt;
            if (!UtcTimestampPattern.IsMatch(updatedAtValue)
                || !DateTimeOffset.TryParse(updatedAtValue, CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out updatedAt))
            {
                throw InvalidFrame();
            }

            double contextPercent = GetNumber(value, "contextPercent");
            if (double.IsNaN(contextPercent) || double.IsInfinity(contextPercent)
                || contextPercent < 0 || contextPercent > 100)
            {
                throw InvalidFrame();
            }

            BridgeSnapshot snapshot = new BridgeSnapshot
            {
                Revision = (long)revisionValue,
                Status = status,
                SessionId = GetString(value, "sessionId", 0, MaximumSessionIdCharacters),
                SessionTitle = GetString(value, "sessionTitle", 0, 160),
                Detail = GetString(value, "detail", 0, 512),
                ContextPercent = contextPercent,
                Unread = GetBoolean(value, "unread"),
                UpdatedAt = updatedAt,
            };
            return new BridgeServerFrame { Type = "snapshot", Snapshot = snapshot };
        }

        private static BridgeServerFrame ParseCommandOk(JsonObject value)
        {
            RequireKeys(value, "v", "type", "requestId");
            return new BridgeServerFrame { Type = "command.ok", RequestId = GetRequestId(value) };
        }

        private static BridgeServerFrame ParseCommandError(JsonObject value)
        {
            RequireKeys(value, "v", "type", "requestId", "code", "message");
            string code = GetString(value, "code", 1, 64);
            if (!CodePattern.IsMatch(code)) throw InvalidFrame();
            return new BridgeServerFrame
            {
                Type = "command.error",
                RequestId = GetRequestId(value),
                ErrorCode = code,
                ErrorMessage = GetString(value, "message", 1, 256),
            };
        }

        private static JsonObject NewFrame(string type)
        {
            JsonObject value = new JsonObject();
            value["v"] = JsonValue.CreateNumberValue(Version);
            value["type"] = JsonValue.CreateStringValue(type);
            return value;
        }

        private static void RequireVersion(JsonObject value)
        {
            double version = GetNumber(value, "v");
            if (version != Version) throw new BridgeProtocolException("unsupported-version");
        }

        private static void RequireKeys(JsonObject value, params string[] expectedKeys)
        {
            HashSet<string> expected = new HashSet<string>(expectedKeys, StringComparer.Ordinal);
            if (value.Count != expected.Count || value.Any(pair => !expected.Contains(pair.Key))) throw InvalidFrame();
        }

        private static string GetRequestId(JsonObject value)
        {
            string requestId = GetString(value, "requestId", 8, MaximumRequestIdCharacters);
            RequireRequestId(requestId);
            return requestId;
        }

        private static string GetString(JsonObject value, string name, int minimum, int maximum)
        {
            IJsonValue item;
            if (!value.TryGetValue(name, out item) || item.ValueType != JsonValueType.String) throw InvalidFrame();
            return RequireString(item.GetString(), minimum, maximum, false);
        }

        private static double GetNumber(JsonObject value, string name)
        {
            IJsonValue item;
            if (!value.TryGetValue(name, out item) || item.ValueType != JsonValueType.Number) throw InvalidFrame();
            double number = item.GetNumber();
            if (double.IsNaN(number) || double.IsInfinity(number)) throw InvalidFrame();
            return number;
        }

        private static bool GetBoolean(JsonObject value, string name)
        {
            IJsonValue item;
            if (!value.TryGetValue(name, out item) || item.ValueType != JsonValueType.Boolean) throw InvalidFrame();
            return item.GetBoolean();
        }

        private static JsonArray GetArray(JsonObject value, string name)
        {
            IJsonValue item;
            if (!value.TryGetValue(name, out item) || item.ValueType != JsonValueType.Array) throw InvalidFrame();
            return item.GetArray();
        }

        private static void RequireRequestId(string value)
        {
            RequireString(value, 8, MaximumRequestIdCharacters, false);
            if (!RequestIdPattern.IsMatch(value)) throw InvalidFrame();
        }

        private static void RequireSessionId(string value)
        {
            RequireString(value, 1, MaximumSessionIdCharacters, false);
        }

        internal static bool IsBlankQuickReply(string value)
        {
            if (string.IsNullOrEmpty(value)) return true;
            foreach (char character in value)
            {
                if (character != '\uFEFF' && !char.IsWhiteSpace(character)) return false;
            }
            return true;
        }

        private static string RequireString(string value, int minimum, int maximum, bool allowLineBreaks)
        {
            if (value == null || value.Length < minimum || value.Length > maximum) throw InvalidFrame();
            foreach (char character in value)
            {
                bool isC0 = character <= '\u001F';
                bool isDeleteOrC1 = character >= '\u007F' && character <= '\u009F';
                if (!isC0 && !isDeleteOrC1) continue;
                if (allowLineBreaks && character == '\n') continue;
                throw InvalidFrame();
            }
            return value;
        }

        private static BridgeProtocolException InvalidFrame()
        {
            return new BridgeProtocolException("invalid-frame");
        }
    }
}
