# Security policy

## Design

- The renderer is sandboxed, has no Node.js integration, and uses a narrow preload bridge.
- Harness RPC and local file preparation run in Electron's main process.
- Files are attached only after an explicit picker action or drag-and-drop.
- Images are capped at 8 MB by the widget. Non-image files are passed to Harness as explicit local `@path` references rather than uploaded elsewhere.
- API keys remain in DeepSeek Harness provider storage and are never read by the widget.
- Sessions created or prompted from the widget are deliberately switched to Harness `danger-full-access`. The agent can read, write, execute, and use configured tools without another permission prompt, so only trusted models, workspaces, MCP servers, and skills should be used.

## Distribution

Portable self-updates and the desktop install script are size-bounded and verified against the SHA-256 digest published by GitHub before installation. Current Windows and macOS artifacts are not code-signed, so SmartScreen or Gatekeeper can warn. Download only from the project's GitHub Releases page, verify `SHA256SUMS.txt` when installing manually, and do not treat bypassing an operating-system warning as proof that a file is authentic.

The updater does not trust the release feed to tell it where to download from or what to
save. The download URL and the asset filename are both built locally from a version string
that must match a strict stable-semver pattern, and a release whose own metadata disagrees
is rejected rather than followed. A release older than or equal to the installed version is
never offered, so a rolled-back feed cannot force a downgrade. The download is streamed
with an overall timeout and a stall timeout, is refused the moment it exceeds either the
declared size or the hard cap, must match the declared size exactly, and is deleted if
verification fails. The replacement helper is written with an exclusive-create flag into
the install directory and run by absolute path with arguments passed as separate argv
entries and no shell, so neither a planted helper nor a crafted path can turn into command
execution.

What that does **not** cover: the digest is published in the same GitHub API response as
the asset it describes. It proves the bytes arrived intact from GitHub; it does not prove
GitHub served what the maintainer intended. A compromised repository or release token could
publish a matching artifact and digest together, and without code signing nothing in the
client would detect it. Treat GitHub account security as part of this project's trust
boundary until signed releases exist.

Report vulnerabilities privately through GitHub Security Advisories. Do not include credentials, private prompts, local paths, or session exports in a public issue.
