# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is currently not compatible with SWC. See [this issue](https://github.com/vitejs/vite-plugin-react/issues/428) for tracking the progress.

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## GitHub Pages

This project is configured to deploy from GitHub Actions using `.github/workflows/deploy-pages.yml`.

To publish it:

1. Push the repository to GitHub.
2. Open `Settings` -> `Pages`.
3. Set the source to `GitHub Actions`.
4. Push to the `main` branch, or run the workflow manually from the `Actions` tab.

For local development:

```bash
cd subtitle-maker-app
npm run dev
```

Notes:

- The Vite `base` path is set automatically for GitHub Pages during the workflow build.
- The preview app will load on Pages, but FFmpeg-based MP4 export may be limited there because GitHub Pages does not provide the isolation headers used by the local dev server.
