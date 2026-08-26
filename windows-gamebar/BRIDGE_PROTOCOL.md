# NeoXider Agent Deck Game Bar bridge protocol v1

The Game Bar widget is a separate UWP app. Its production bridge to the desktop deck uses a local named pipe, following Microsoft's documented Game Bar guidance for communication with Win32 apps.

## Transport and security

- Endpoint: `\\.\pipe\NeoXider.AgentDeck.GameBar.v1`
- Server: the NeoXider Agent Deck desktop process.
- Client: the packaged Game Bar widget.
- Encoding: UTF-8 JSON Lines; one JSON object followed by `\n`.
- Maximum frame: 65536 bytes, including the newline.
- The desktop server must grant access to the installed package SID as documented by Microsoft. It must not expose a TCP listener.
- The server rejects oversized frames, invalid JSON, unsupported protocol versions, unknown command names, and stale request identifiers.
- Session ids are opaque. No API keys, model credentials, prompts from other sessions, or filesystem paths are sent unless required by a user-initiated action.

## Handshake

Client:

```json
{"v":1,"type":"hello","client":"gamebar","requestId":"9dbe3f87"}
```

Server:

```json
{"v":1,"type":"hello.ok","requestId":"9dbe3f87","serverVersion":"0.5.0","capabilities":["snapshot","ack","open-session","quick-reply"]}
```

## State snapshot

```json
{"v":1,"type":"snapshot","revision":42,"status":"writing","sessionId":"opaque-id","sessionTitle":"Widget smoke","detail":"Writing response","contextPercent":29,"unread":true,"updatedAt":"2026-08-27T12:00:00Z"}
```

`status` is one of `idle`, `thinking`, `writing`, `tool`, `waiting`, `done`, `error`, or `offline`. Revisions increase monotonically for one desktop process lifetime. The widget ignores an older revision.

## User actions

```json
{"v":1,"type":"command","requestId":"f7d1fb2c","command":"request-snapshot"}
{"v":1,"type":"command","requestId":"47baca1b","command":"ack","sessionId":"opaque-id"}
{"v":1,"type":"command","requestId":"c33f6321","command":"open-session","sessionId":"opaque-id"}
{"v":1,"type":"command","requestId":"fb12177a","command":"quick-reply","sessionId":"opaque-id","text":"Continue"}
```

The desktop app answers every command with either `command.ok` or `command.error` carrying the same `requestId`. `quick-reply` is never sent implicitly and is subject to the same queueing behavior as the normal mini-chat.

## Phase boundary

The current isolated companion implements Game Bar activation, pinning, the status surface, and host theme/opacity behavior. It deliberately renders `offline` until the desktop named-pipe server and package-SID ACL are integrated. This prevents a decorative prototype from pretending that agent state is live.
