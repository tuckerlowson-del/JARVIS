# JARVIS 3.4.0

Lightweight Windows-first personal assistant with a local-first command router, LAN phone remote, memory, automations, diagnostics and GitHub releases.

## What changed in 3.4.0

- Lazy-loads hardware telemetry so startup stays lighter.
- Restores the LAN phone remote directly on the Command Center.
- Shows the live remote URL and 5-character pairing token.
- Adds real Windows brightness controls through Windows WMI.
- Adds volume up/down/mute through Windows multimedia keys.
- Adds media play/pause/next/previous.
- Adds direct Windows Settings shortcuts.
- Adds sleep/restart/shutdown commands.
- Adds Wi-Fi adapter status diagnostics.
- Adds local command suggestions without requiring a cloud AI key.
- Removes the invalid electron-builder `publishUrl` setting that caused the Windows build schema failure.
- Uses the GitHub updater configuration for Windows releases.

Windows brightness support depends on Windows exposing the WMI monitor brightness interface; Microsoft documents `WmiMonitorBrightnessMethods.WmiSetBrightness` for setting monitor brightness. citeturn1search0turn1search5

## Build

```bash
npm install
npm run build
```

The generated Windows installer is published through the GitHub Actions release workflow.

## LAN remote

JARVIS listens on `0.0.0.0:47821`. The desktop dashboard displays the exact LAN URL and pairing token. On a phone connected to the same LAN, open the displayed `/phone` address and enter the 5-character token.

The remote is local-LAN only by default; JARVIS does not intentionally expose it to the public internet.

## Local AI

Ollama is supported as a local provider. No API key is required for the built-in Windows command router. AI endpoints and API keys remain configurable and are not hard-coded.

## Update system

Windows releases are published to GitHub Releases. Electron's Windows updater supports GitHub-backed release distribution, and GitHub releases provide downloadable release assets. citeturn0search1turn0search2

## Security

JARVIS does not log passwords, cookies or authentication tokens. System controls are implemented as explicit application actions rather than passing arbitrary natural-language text directly to a shell.
