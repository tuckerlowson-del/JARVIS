# JARVIS 3.2.0

## Release changes

- Simplified the project root so the existing 3.1.0 Windows and Android source is not hidden behind unnecessary nested folders.
- Corrected the Electron entry point to use the actual root `main.js`.
- Updated electron-builder packaging to include the real root application files.
- Added GitHub Releases publishing configuration for Windows builds.
- Added a GitHub Actions release workflow.
- Kept the lightweight startup architecture and real local controls from 3.1.0.
