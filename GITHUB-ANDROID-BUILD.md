# Build the JARVIS APK on GitHub

## 1. Create a GitHub repository

Create an empty repository on GitHub. Do not add secrets or API keys to the repository.

## 2. Upload this project

Upload the contents of this folder, including `.github/workflows/android-build.yml` and the `android` folder.

## 3. Start the build

Go to **Actions** → **Build JARVIS Android APK** → **Run workflow**.

A successful run produces an artifact named **jarvis-android-debug-apk**.

## 4. Install on your phone

Download the artifact, extract it, and install `app-debug.apk`.

You may need to allow your browser/file manager to install unknown apps in Android Settings.

## Security

Never upload OpenAI, Gemini, Claude, Grok, DeepSeek, or Perplexity API keys into GitHub. Put those credentials into JARVIS locally instead.
