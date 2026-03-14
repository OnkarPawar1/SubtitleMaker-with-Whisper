# Subtitle Studio

This project now supports two runtimes:

- Web preview via Vite and GitHub Pages
- Desktop export via Electron with native file saving and bundled FFmpeg conversion

## Desktop App

Use the desktop app when you need reliable exports.

```bash
cd subtitle-maker-app
npm install
npm run dev:desktop
```

Packaging for macOS:

```bash
cd subtitle-maker-app
npm run build:desktop
```

This creates installable output in `subtitle-maker-app/release/`.

## Web Preview

For browser-only preview:

```bash
cd subtitle-maker-app
npm run dev
```

GitHub Pages remains useful for trying the UI, but browser-hosted export is inherently less reliable than the desktop app.

## GitHub Pages

This repository is configured to deploy the Vite preview to GitHub Pages using `.github/workflows/deploy-pages.yml`.

To publish it:

1. Push the repository to GitHub.
2. Open `Settings` -> `Pages`.
3. Set the source to `GitHub Actions`.
4. Push to the `main` branch, or rerun the workflow from the `Actions` tab.
