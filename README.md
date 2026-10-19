# md-tool

Extensão para VS Code que permite visualizar, editar e exportar Markdown (`.md`) para PDF e RTF.

> Em desenvolvimento. O planejamento está em `docs/PLANEJAMENTO.md`.

## Desenvolvimento

```sh
npm install
npm run watch        # build contínuo
```

Pressione `F5` no VS Code para abrir o Extension Development Host.

| Script                     | Função                                                               |
| -------------------------- | -------------------------------------------------------------------- |
| `npm run compile`          | Verifica tipos e gera `dist/`                                        |
| `npm run lint`             | ESLint                                                               |
| `npm run format`           | Prettier                                                             |
| `npm test`                 | Testes unitários (vitest)                                            |
| `npm run test:integration` | Testes dentro do VS Code (baixa o VS Code 1.90 na primeira execução) |
| `npm run vsix`             | Gera o pacote `.vsix`                                                |
