# NeoXider Agent Deck Game Bar bridge protocol v1

The Game Bar widget is a separate UWP app. Its production bridge to the desktop deck uses a local named pipe, following Microsoft's documented Game Bar guidance for communication with Win32 apps.

## Transport and security

- Endpoint: `\\.\pipe\LOCAL\NeoXider.AgentDeck.GameBar.v1`. The packaged client passes `LOCAL\NeoXider.AgentDeck.GameBar.v1` to .NET pipe APIs, which add the `\\.\pipe\` prefix.
- Server: the NeoXider Agent Deck desktop process.
- Client: the packaged Game Bar widget.
- Encoding: UTF-8 JSON Lines; one JSON object followed by `\n`.
- Maximum frame: 65536 bytes, including the newline.
- The desktop server creates the pipe for SYSTEM, the current desktop user, and the exact installed widget package SID. It resolves that SID from the installed package identity rather than trusting a client-supplied value or a development manifest placeholder; no World/Everyone ACE is granted.
- After each connection, the server impersonates the pipe client and verifies that its token is an AppContainer token whose AppContainer SID equals the installed widget package SID. This keeps identity verification independent from ACL construction. Authentication failure closes the connection before any frame is processed.
- The server must reject remote clients and must not expose a TCP listener.
- The server rejects oversized frames, invalid JSON, unsupported protocol versions, unknown command names, and stale request identifiers.
- Session ids are opaque. No API keys, model credentials, prompts from other sessions, or filesystem paths are sent unless required by a user-initiated action.

## Handshake

Client:

```json
{"v":1,"type":"hello","client":"gamebar","requestId":"9dbe3f87"}
```

Server:

```json
{"v":1,"type":"hello.ok","requestId":"9dbe3f87","serverVersion":"0.6.1","capabilities":["snapshot","ack","open-session","quick-reply"]}
```

Version 1 requires that `hello.ok.capabilities` contain that complete four-item set exactly once (order is not significant). A missing, duplicate, or unknown capability fails the handshake; the widget stays offline and reconnects. This keeps command availability deterministic without presenting controls that the connected server cannot honor.

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

Protocol strings reject C0 controls except LF in `quick-reply.text`, and reject DEL plus all C1 controls. A quick reply containing only Unicode whitespace and/or U+FEFF is invalid. Snapshot timestamps use canonical UTC years `0001` through `9999`; year `0000` is invalid on both peers.

## Phase boundary

The desktop BridgeHost and UWP client implement this contract. The host resolves the installed package identity, authenticates the connecting AppContainer, and retires after one authenticated connection so frames cannot cross process generations. Until the UWP package is installed and pinned, the companion honestly remains unavailable rather than presenting synthetic live state.
