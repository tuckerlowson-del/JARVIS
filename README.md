# JARVIS Android Companion

This is the native Android companion for JARVIS PC.

## Build without Android Studio

This repository includes a GitHub Actions workflow. Upload the project to GitHub, then:

1. Open **Actions**.
2. Select **Build JARVIS Android APK**.
3. Press **Run workflow**.
4. Wait for the green check mark.
5. Open the completed workflow run.
6. Under **Artifacts**, download **jarvis-android-debug-apk**.
7. Extract the downloaded artifact and install `app-debug.apk` on your Android phone.

The workflow builds a debug APK and does not require Android Studio on your PC or phone.

## Local build

If Gradle is installed locally:

```bash
cd android
gradle assembleDebug
```

The APK will be at:

`app/build/outputs/apk/debug/app-debug.apk`

## Notes

- The Accessibility Service is optional and must be explicitly enabled in Android Settings.
- Network access is used for the local JARVIS PC connection.
- The app does not bypass Android security controls.
