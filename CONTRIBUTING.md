# Contributing

## Setup

```sh
npm install
npm run watch        # continuous build
```

Press `F5` in VS Code to open an Extension Development Host. The plan and design decisions
(in Portuguese) are in [docs/PLANEJAMENTO.md](docs/PLANEJAMENTO.md).

## Scripts

| Script                     | Purpose                                                                |
| -------------------------- | ---------------------------------------------------------------------- |
| `npm run compile`          | Type-check and build `dist/`                                           |
| `npm run lint`             | ESLint                                                                 |
| `npm run format`           | Prettier                                                               |
| `npm test`                 | Unit tests (vitest)                                                    |
| `npm run test:browser`     | Preview webview tests in Chrome/Edge (development only)                |
| `npm run test:integration` | Tests inside VS Code (downloads VS Code 1.90 on the first run)         |
| `npm run vsix`             | Production build and `.vsix` package (with `THIRD-PARTY-NOTICES.txt`)  |
| `npm run screenshots`      | Recaptures the README images from a real VS Code window (Windows only) |

`npm run screenshots` opens a VS Code window for about a minute, keeps it on top while it
captures, and renders the PDF/RTF comparison with LibreOffice when it is installed. The demo
document is [docs/demo/demo.md](docs/demo/demo.md); the script is in
[scripts/screenshots](scripts/screenshots). The icon is `media/icon.svg`; after changing it,
run `node scripts/render-icon.mjs`.

The extension never uses a browser: Chrome/Edge only stand in for the VS Code webview in
`npm run test:browser`.

## Releasing

1. Update the version in `package.json` and move the "Unreleased" notes in `CHANGELOG.md`
   under it.
2. Commit, tag `vX.Y.Z` and push the tag. The **Release** workflow tests, packages and
   publishes to the Visual Studio Marketplace and Open VSX, and attaches the `.vsix` to a
   GitHub release.

The workflow needs two repository secrets:

- `VSCE_PAT`: an Azure DevOps personal access token with the **Marketplace (Manage)** scope,
  for the `JefersonPontes` publisher.
- `OVSX_PAT`: an [open-vsx.org](https://open-vsx.org) access token. The `JefersonPontes`
  namespace must exist there once (`npx ovsx create-namespace JefersonPontes -p <token>`).
