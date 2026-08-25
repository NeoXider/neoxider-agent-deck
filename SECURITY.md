# Security policy

## Design

- The renderer is sandboxed, has no Node.js integration, and uses a narrow preload bridge.
- Harness RPC and local file preparation run in Electron's main process.
- Files are attached only after an explicit picker action or drag-and-drop.
- Images are capped at 8 MB by the widget. Non-image files are passed to Harness as explicit local `@path` references rather than uploaded elsewhere.
- API keys remain in DeepSeek Harness provider storage and are never read by the widget.

Report vulnerabilities privately through GitHub Security Advisories. Do not include credentials, private prompts, local paths, or session exports in a public issue.
