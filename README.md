# JARVIS Personal Assistant 3.2.0

Lightweight Windows Electron assistant with a native Android companion and LAN web remote.

## Layout

- `src/` — Electron main/preload
- `public/desktop/` — Windows UI
- `public/phone/` — phone web remote
- `public/web/` — LAN web command center
- `android/` — native Android Gradle project
- `.github/workflows/` — Windows release and Android APK builds

## Run Windows

```powershell
npm ci
npm start
```

Build installer: `npm run build`.

## Android

Run **Actions → Build JARVIS Android APK**. The workflow uploads the debug APK as an artifact.

JARVIS only controls authorized devices and does not bypass Windows or Android authentication. Keep port 47821 on a trusted private network and never commit API keys.
