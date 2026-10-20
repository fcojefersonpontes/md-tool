# md-tool

Extensão para VS Code que permite visualizar, editar e exportar Markdown (`.md`) para PDF e RTF.

> Em desenvolvimento. O planejamento está em `docs/PLANEJAMENTO.md`.

## Funcionalidades

- **Preview ao vivo** lado a lado (`Ctrl+K Alt+V` ou o botão na barra do editor), com scroll sincronizado.
- GFM (tabelas, task lists clicáveis, notas de rodapé), realce de código, fórmulas KaTeX e diagramas Mermaid.
- Tema automático (segue o VS Code), claro ou escuro, e CSS personalizado.

### Configurações

| Chave                       | Padrão  | Descrição                          |
| --------------------------- | ------- | ---------------------------------- |
| `mdTool.preview.theme`      | `auto`  | `auto`, `light` ou `dark`          |
| `mdTool.preview.customCss`  | `[]`    | Folhas de estilo extras            |
| `mdTool.preview.scrollSync` | `true`  | Sincronizar rolagem                |
| `mdTool.markdown.allowHtml` | `false` | Renderizar HTML bruto (sanitizado) |
| `mdTool.markdown.math`      | `true`  | Fórmulas KaTeX                     |
| `mdTool.markdown.mermaid`   | `true`  | Diagramas Mermaid                  |

Exportação para PDF e RTF chega na Fase 2.

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
