# md-tool

Extensão para VS Code que permite visualizar, editar e exportar Markdown (`.md`) para PDF e RTF.

> Em desenvolvimento. O planejamento está em `docs/PLANEJAMENTO.md`.

## Funcionalidades

- **Preview ao vivo** lado a lado (`Ctrl+K Alt+V` ou o botão na barra do editor), com scroll sincronizado.
- GFM (tabelas, task lists clicáveis, notas de rodapé), realce de código, fórmulas KaTeX e diagramas Mermaid.
- Tema automático (segue o VS Code), claro ou escuro, e CSS personalizado.
- **Exportar para PDF** (usa o Chrome, Edge ou Chromium instalado) e **para RTF**, pelo menu de
  contexto do editor, do Explorer ou pelos botões do preview.
- **Edição**: negrito, itálico, tachado, código e bloco de código (alternam liga/desliga, com
  vários cursores), inserir link, formatar tabelas, sumário (TOC) e continuação de listas no Enter.

### Edição

| Comando                                            | Atalho                             | O que faz                                                                                 |
| -------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| Alternar Negrito / Itálico                         | `Ctrl+B` / `Ctrl+I`                | Envolve a seleção (ou a palavra sob o cursor) em `**` / `_`; de novo, remove              |
| Alternar Tachado / Código Inline / Bloco de Código | menu de contexto                   | `~~`, `` ` `` e bloco cercado por três crases                                             |
| Inserir Link                                       | `Ctrl+K L`                         | Pede o endereço (sugere a URL da área de transferência); URL selecionada vira link direto |
| Formatar Tabelas                                   | `Shift+Alt+F` (Formatar Documento) | Alinha as colunas, respeitando acentos, CJK e emoji                                       |
| Inserir / Atualizar Sumário                        | menu de contexto                   | Lista os títulos entre `<!-- toc -->` e `<!-- tocstop -->`; atualiza ao salvar            |
| Enter numa lista                                   | `Enter`                            | Continua `-`, `1.`, `- [ ]` e `>`; num item vazio, encerra a lista                        |

Os comandos ficam no submenu **Markdown (md-tool)** do menu de contexto do editor.

Outline, recolhimento de seções, completar caminhos e colar/arrastar imagens já vêm na extensão de
Markdown do VS Code. Para salvar as imagens coladas numa pasta `assets/` ao lado do documento:

```json
"markdown.copyFiles.destination": { "**/*.md": "${documentDirName}/assets/${fileName}" }
```

### Configurações

| Chave                              | Padrão           | Descrição                                    |
| ---------------------------------- | ---------------- | -------------------------------------------- |
| `mdTool.preview.theme`             | `auto`           | `auto`, `light` ou `dark`                    |
| `mdTool.preview.customCss`         | `[]`             | Folhas de estilo extras                      |
| `mdTool.preview.scrollSync`        | `true`           | Sincronizar rolagem                          |
| `mdTool.markdown.allowHtml`        | `false`          | Renderizar HTML bruto (sanitizado)           |
| `mdTool.markdown.math`             | `true`           | Fórmulas KaTeX                               |
| `mdTool.markdown.mermaid`          | `true`           | Diagramas Mermaid                            |
| `mdTool.export.outputDir`          | `${fileDirname}` | Pasta de saída (aceita `${workspaceFolder}`) |
| `mdTool.export.askLocation`        | `false`          | Perguntar onde salvar                        |
| `mdTool.export.pageSize`           | `A4`             | `A4`, `Letter` ou `Legal`                    |
| `mdTool.export.landscape`          | `false`          | Orientação paisagem                          |
| `mdTool.export.margin`             | `20mm`           | Margens (abreviação CSS)                     |
| `mdTool.pdf.executablePath`        | (auto)           | Navegador usado para o PDF                   |
| `mdTool.pdf.headerTemplate`        | vazio            | HTML do cabeçalho                            |
| `mdTool.pdf.footerTemplate`        | nº da página     | HTML do rodapé                               |
| `mdTool.rtf.fontFamily`            | `Calibri`        | Fonte do RTF                                 |
| `mdTool.rtf.codeFontFamily`        | `Consolas`       | Fonte do código no RTF                       |
| `mdTool.rtf.fontSize`              | `11`             | Tamanho da fonte (pt)                        |
| `mdTool.editor.listContinuation`   | `true`           | Continuar listas no Enter                    |
| `mdTool.editor.formatTables`       | `true`           | Formatador de Markdown que alinha tabelas    |
| `mdTool.toc.minLevel` / `maxLevel` | `2` / `3`        | Níveis de título incluídos no sumário        |
| `mdTool.toc.updateOnSave`          | `true`           | Atualizar o sumário ao salvar                |

### Opções por documento

O front-matter pode sobrescrever as opções do PDF:

```yaml
---
title: Relatório
pdf:
  format: Letter
  landscape: true
  margin: 15mm 20mm
  headerTemplate: '<div style="font-size:9px;width:100%;text-align:center"><span class="title"></span></div>'
---
```

### Fórmulas, diagramas e imagens no RTF

O RTF não sabe desenhar fórmulas, diagramas Mermaid nem imagens SVG/GIF/WebP. Na exportação, a
extensão usa o mesmo navegador do PDF (Chrome, Edge ou Chromium) para renderizá-los como imagens
PNG e embuti-las no documento. Sem navegador instalado, fórmulas saem como TeX, diagramas como
código e essas imagens como o texto alternativo, com um aviso.

Fórmulas inline ficam alinhadas à linha de base do texto. As que descem abaixo dela (subscritos,
frações) usam o comando de rebaixamento do RTF, que o LibreOffice ignora; nele, essas fórmulas
aparecem um pouco acima da linha.

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
| `npm run test:browser`     | Testes do preview e do PDF num navegador real (Chrome/Edge)          |
| `npm run test:integration` | Testes dentro do VS Code (baixa o VS Code 1.90 na primeira execução) |
| `npm run vsix`             | Gera o pacote `.vsix`                                                |
