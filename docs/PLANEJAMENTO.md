# md-tool: Planejamento da extensão VS Code

Extensão para **visualizar, editar e exportar (PDF / RTF)** arquivos Markdown (`.md`).

---

## 1. Objetivos e escopo

### Objetivos

1. **Visualizar**: preview ao vivo, lado a lado, com scroll sincronizado, tema claro/escuro e suporte a GFM (tabelas, task lists, notas de rodapé), realce de código, fórmulas (KaTeX) e diagramas (Mermaid).
2. **Editar**: manter o editor de texto nativo do VS Code (ele já é ótimo) e acrescentar comandos de produtividade: negrito/itálico, links, formatação de tabelas, sumário (TOC), colar imagem da área de transferência.
3. **Exportar**: gerar **PDF** e **RTF** fiéis ao preview, com opções de página (tamanho, margens, cabeçalho/rodapé) e CSS customizável.

### Fora de escopo (v1)

- Editor WYSIWYG completo (fica para a Fase 4, opcional).
- Exportar DOCX/HTML-slides (dá para incluir depois aproveitando a mesma arquitetura).
- Sincronização em nuvem e colaboração.

### Princípio-chave

**Um único pipeline de renderização** (`markdown-it` + plugins) alimenta o preview, o PDF e o RTF. Assim o resultado exportado sai igual ao que o usuário vê. Por isso a extensão tem o próprio preview em vez de só estender o preview nativo (`markdown.markdownItPlugins`).

---

## 2. Stack técnica

| Área                 | Escolha                                                                                        | Motivo                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Linguagem            | TypeScript (strict)                                                                            | Padrão para extensões VS Code                                                 |
| Bundler              | esbuild                                                                                        | Build rápido, um bundle para a extensão e outro para o webview                |
| Parser MD            | `markdown-it`                                                                                  | Rápido, extensível, gera um token stream reaproveitável para o RTF            |
| Plugins MD           | `markdown-it-anchor`, `-footnote`, `-task-lists`, `-front-matter`, `@vscode/markdown-it-katex` | Cobertura GFM + extras                                                        |
| Realce de código     | `shiki`                                                                                        | Usa as gramáticas TextMate do VS Code, cores iguais às do editor              |
| Diagramas            | `mermaid` (só no webview e no navegador headless)                                              | Precisa de JS para renderizar                                                 |
| Sanitização          | `DOMPurify` (no webview) / `html: false` configurável                                          | Segurança contra HTML malicioso no `.md`                                      |
| PDF                  | `puppeteer-core` + Chrome/Edge já instalado na máquina                                         | Fidelidade total ao HTML/CSS e Mermaid. Sem empacotar o Chromium (~150 MB)    |
| RTF                  | Conversor próprio (token stream → RTF)                                                         | Não existe biblioteca JS madura para isso; RTF é texto e dá para gerar direto |
| RTF (alternativa)    | Pandoc, se estiver instalado                                                                   | Backend opcional via configuração                                             |
| Testes unitários     | `vitest`                                                                                       | Para o núcleo, que não depende do VS Code                                     |
| Testes de integração | `@vscode/test-electron` + `@vscode/test-cli`                                                   | Testa comandos e ativação dentro do VS Code                                   |
| Empacotamento        | `@vscode/vsce`                                                                                 | Gera o `.vsix` e publica no Marketplace / Open VSX                            |

VS Code mínimo: `^1.90.0`.

---

## 3. Arquitetura

```
┌────────────────────────── Extension Host (Node) ──────────────────────────┐
│                                                                           │
│  extension.ts ── registra comandos, providers, listeners de configuração  │
│        │                                                                  │
│        ├── preview/PreviewManager ──► WebviewPanel (1 por documento)       │
│        │        ▲ onDidChangeTextDocument (debounce 150 ms)               │
│        │        │ postMessage({type:'update', html, line})                │
│        │                                                                  │
│        ├── editor/commands  (bold, table format, TOC, paste image…)       │
│        │                                                                  │
│        ├── export/ExportService                                           │
│        │        ├── pdf/PdfExporter  ── puppeteer-core ─► Chrome/Edge     │
│        │        └── rtf/RtfExporter  ── RtfRenderer (tokens → RTF)        │
│        │                                                                  │
│        └── core/  (puro, sem dependência de `vscode`, 100% testável)      │
│               ├── MarkdownEngine   (markdown-it + plugins)                │
│               ├── HtmlDocument     (monta HTML completo + CSS + tema)     │
│               └── ImageResolver    (caminhos relativos → URI/base64)      │
└───────────────────────────────────────────────────────────────────────────┘

┌──────── Webview (browser sandbox) ────────┐
│ preview.ts: recebe HTML, aplica DOMPurify, │
│ roda mermaid/KaTeX, sincroniza scroll,     │
│ envia cliques em links / checkboxes        │
└────────────────────────────────────────────┘
```

### Estrutura de pastas

```
md-tool/
├── package.json              # manifesto: contributes (commands, menus, keybindings, configuration)
├── esbuild.mjs
├── tsconfig.json
├── src/
│   ├── extension.ts
│   ├── config.ts             # leitura tipada das configurações
│   ├── core/
│   │   ├── MarkdownEngine.ts
│   │   ├── HtmlDocument.ts
│   │   ├── ImageResolver.ts
│   │   └── plugins/sourceLines.ts   # adiciona data-line nos blocos (scroll sync)
│   ├── preview/
│   │   ├── PreviewManager.ts
│   │   └── PreviewPanel.ts
│   ├── editor/
│   │   ├── formatting.ts
│   │   ├── tableFormatter.ts
│   │   ├── toc.ts
│   │   └── pasteImage.ts
│   └── export/
│       ├── ExportService.ts
│       ├── pdf/PdfExporter.ts
│       ├── pdf/browserLocator.ts    # acha Chrome/Edge/Chromium por SO
│       └── rtf/
│           ├── RtfRenderer.ts
│           ├── rtfEscape.ts
│           └── rtfImages.ts
├── webview/
│   ├── preview.ts
│   └── preview.css
├── media/
│   ├── themes/github-light.css, github-dark.css
│   └── print.css
└── test/
    ├── unit/                 # vitest: engine, rtf, tableFormatter, toc
    ├── fixtures/*.md + golden/*.rtf
    └── integration/          # @vscode/test-electron
```

---

## 4. Funcionalidades em detalhe

### 4.1 Visualização

- **Comandos:** `mdTool.openPreview` (mesma aba), `mdTool.openPreviewToSide` (`Ctrl+K Alt+V`, para não conflitar com o `Ctrl+K V` do preview nativo).
- **Atualização ao vivo:** `onDidChangeTextDocument` com debounce; só o HTML do corpo é enviado via `postMessage`, sem recarregar o webview.
- **Scroll sincronizado:** o plugin `sourceLines` grava `data-line` nos blocos. Editor → preview via `onDidChangeTextEditorVisibleRanges`; preview → editor via mensagem `revealLine`.
- **Links:** links relativos para `.md` abrem no editor; âncoras rolam o preview; links externos usam `vscode.env.openExternal`.
- **Task lists clicáveis:** marcar um checkbox no preview edita o `[ ]` / `[x]` na linha correspondente (via `WorkspaceEdit`).
- **Tema:** segue o tema do VS Code (`body.vscode-dark`), ou força claro/escuro, ou usa CSS do usuário (`mdTool.preview.customCss`).
- **Segurança:** CSP com `nonce`, `localResourceRoots` restrito ao workspace e à pasta da extensão, HTML bruto desabilitado por padrão em workspaces não confiáveis (Workspace Trust).

### 4.2 Edição

| Comando                                                         | Atalho                                        | Descrição                                      |
| --------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| `mdTool.toggleBold` / `toggleItalic`                            | `Ctrl+B` / `Ctrl+I` (só em Markdown editável) | Envolve/remove `**` / `_`                      |
| `mdTool.toggleStrikethrough` / `toggleCode` / `toggleCodeBlock` | — (menu de contexto)                          | `~~`, código inline, bloco cercado             |
| `mdTool.insertLink`                                             | `Ctrl+K L`                                    | Pede a URL e insere `[texto](url)`             |
| `mdTool.formatTables` + formatador do documento                 | `Shift+Alt+F`                                 | Alinha colunas (respeita largura de CJK/emoji) |
| `mdTool.insertToc` / atualização ao salvar                      | —                                             | TOC entre `<!-- toc -->` e `<!-- tocstop -->`  |
| Continuação de listas (`mdTool.onEnterKey`)                     | `Enter`                                       | Continua `-`, `1.`, `- [ ]`, `>`               |

Decisões tomadas na implementação (Fase 3):

- **Sem atalho para código inline**: `` Ctrl+` `` abre o terminal, e sobrescrevê-lo no editor de Markdown
  seria intrusivo. O tachado também ficou sem atalho (`Alt+S` abre o menu Seleção no Windows).
- **Colar imagem, outline, folding e completar caminhos não foram implementados**: a extensão de
  Markdown embutida no VS Code já oferece todos (colar/arrastar copia o arquivo para o workspace,
  configurável por `markdown.copyFiles.destination`). Reimplementar criaria entradas duplicadas no
  outline e nos menus, e a API de colar (`DocumentPasteEditProvider`) não é estável no VS Code 1.90.
- **Fim de linha**: as edições usam o EOL do documento informado pelo VS Code; um arquivo de uma
  linha não revela o EOL pelo texto.

### 4.3 Exportação para PDF

Fluxo:

1. `MarkdownEngine` → HTML do corpo.
2. `HtmlDocument` monta o HTML completo: tema de impressão (`print.css`), CSS do usuário, KaTeX CSS e imagens convertidas para `file://` ou base64.
3. `browserLocator` encontra o navegador nesta ordem: `mdTool.pdf.executablePath` → Chrome → Edge → Chromium. No Windows o Edge está sempre presente, o que garante funcionamento sem configuração.
4. `puppeteer-core` abre o HTML, aguarda Mermaid/fontes (`document.fonts.ready` + flag `window.__mdToolReady`) e chama `page.pdf()` com:
   - `format` (A4/Letter), `margin`, `printBackground`
   - `displayHeaderFooter` com templates (título, `pageNumber/totalPages`, data)
5. Salva ao lado do `.md` (ou pergunta com `showSaveDialog`, conforme configuração) e oferece "Abrir arquivo".

Progresso com `window.withProgress` e cancelamento. Se nenhum navegador for encontrado, aparece uma mensagem com um botão para configurar o caminho.

Front-matter pode sobrescrever opções por documento:

```yaml
---
title: Relatório
pdf: { format: A4, margin: '20mm', headerTemplate: "<span class='title'></span>" }
---
```

### 4.4 Exportação para RTF

Renderer próprio que percorre o **token stream** do `markdown-it` (não o HTML):

| Markdown                              | RTF                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| Títulos H1–H6                         | Estilos `\s1..\s6` na `\stylesheet` (tamanho e negrito)                               |
| Parágrafo                             | `\pard ... \par`                                                                      |
| **negrito** / _itálico_ / ~~riscado~~ | `\b`, `\i`, `\strike`                                                                 |
| `código inline`                       | Fonte monoespaçada (`\f1`) + `\highlight`                                             |
| Bloco de código                       | `\pard` com fonte mono, `\cbpat` (sombreamento), recuo                                |
| Listas (aninhadas)                    | `\li` / `\fi` com marcador ou número gerado (mais robusto que `\listtable`)           |
| Citação                               | Recuo esquerdo + borda `\brdrl`                                                       |
| Tabela                                | `\trowd`, `\cellx` (larguras proporcionais), `\intbl ... \cell`, `\row`               |
| Link                                  | `{\field{\*\fldinst HYPERLINK "url"}{\fldrslt texto}}`                                |
| Imagem PNG/JPEG                       | `{\pict\pngblip\picwgoalN\pichgoalN <hex>}` (SVG é rasterizado ou ignorado com aviso) |
| Linha horizontal                      | Parágrafo com `\brdrb`                                                                |
| Unicode                               | `\uN?` para caracteres fora do ASCII (acentos, emoji via surrogates)                  |

- Escapar `\`, `{` e `}`.
- Mermaid, KaTeX e imagens SVG/GIF/WebP não têm equivalente em RTF: são renderizados pelo navegador headless e embutidos como PNG. Sem navegador, saem como código/TeX/texto alternativo, com aviso.
- **Testes golden:** cada fixture `.md` gera um `.rtf` comparado com o esperado, e a validação manual é feita abrindo no Word, LibreOffice e WordPad.
- Backend alternativo (futuro, não implementado na v1): `mdTool.rtf.engine: "builtin" | "pandoc"`.

---

## 5. Configurações (`contributes.configuration`)

| Chave                                                   | Tipo                      | Padrão                        |
| ------------------------------------------------------- | ------------------------- | ----------------------------- |
| `mdTool.preview.theme`                                  | `auto \| light \| dark`   | `auto`                        |
| `mdTool.preview.customCss`                              | string[] (caminhos)       | `[]`                          |
| `mdTool.preview.scrollSync`                             | boolean                   | `true`                        |
| `mdTool.markdown.allowHtml`                             | boolean                   | `false`                       |
| `mdTool.markdown.math` / `.mermaid`                     | boolean                   | `true`                        |
| `mdTool.export.outputDir`                               | string (`${fileDirname}`) | `${fileDirname}`              |
| `mdTool.export.askLocation`                             | boolean                   | `false`                       |
| `mdTool.pdf.executablePath`                             | string                    | `""` (auto)                   |
| `mdTool.export.pageSize`                                | `A4 \| Letter \| Legal`   | `A4`                          |
| `mdTool.export.landscape`                               | boolean                   | `false`                       |
| `mdTool.export.margin`                                  | string                    | `"20mm"`                      |
| `mdTool.pdf.headerTemplate` / `footerTemplate`          | string                    | rodapé com nº da página       |
| `mdTool.rtf.fontFamily` / `codeFontFamily` / `fontSize` | string / string / number  | `Calibri` / `Consolas` / `11` |
| `mdTool.images.pasteFolder`                             | string                    | `assets`                      |

---

## 6. Contribuições de UI

- Botão de preview na barra de título do editor (`editor/title`, `when: editorLangId == markdown`).
- Menu de contexto no Explorer e no editor: **Exportar para PDF**, **Exportar para RTF**.
- Item na status bar durante a exportação.
- Ativação: `onLanguage:markdown` + comandos. Nada de `*`.

---

## 7. Roadmap por fases

### Fase 0: Fundação (1–2 dias)

- Scaffold (`yo code` ou manual), esbuild com dois bundles, ESLint + Prettier, vitest, CI no GitHub Actions (lint, testes e `vsce package` em Windows, macOS e Linux).
- **Pronto quando:** `F5` abre o Extension Development Host e um comando "Hello" funciona, e a CI passa.

### Fase 1: Preview (MVP de visualização) (4–6 dias)

- `MarkdownEngine` + plugins, `PreviewManager`, live update, tema, CSP, imagens relativas, links.
- Scroll sincronizado e task lists clicáveis.
- **Pronto quando:** um documento com tabela, código, KaTeX, Mermaid e imagem renderiza corretamente e atualiza a cada tecla sem piscar.

### Fase 2: Exportação (5–8 dias)

- 2a. PDF: `browserLocator`, `PdfExporter`, `print.css`, cabeçalho e rodapé, opções via front-matter.
- 2b. RTF: `RtfRenderer` com cobertura da tabela da seção 4.4 e testes golden.
- **Pronto quando:** o PDF fica visualmente igual ao preview e o RTF abre sem erro no Word, LibreOffice e WordPad, preservando títulos, listas, tabelas, links e imagens.

### Fase 3: Edição (3–5 dias)

- Comandos de formatação, continuação de listas, formatador de tabelas e TOC (colar imagem, outline e folding: nativos do VS Code, ver 4.2).
- **Pronto quando:** todos os comandos da seção 4.2 têm teste unitário e funcionam com seleção múltipla (multi-cursor).

### Fase 4: Polimento e publicação (2–3 dias)

- README com GIFs, ícone, CHANGELOG, `l10n` (pt-BR e en), telemetria desligada.
- Publicação no VS Code Marketplace e no Open VSX.
- **Feito:**
  - README em inglês (exibido no Marketplace) e `README.pt-BR.md`, com imagens capturadas de uma janela real do VS Code por `npm run screenshots` (`scripts/screenshots`, só Windows).
  - Ícone em `media/icon.svg`, convertido para `media/icon.png` por `scripts/render-icon.mjs`.
  - LICENSE (MIT) e `dist/THIRD-PARTY-NOTICES.txt`, gerado no build de produção a partir do metafile do esbuild.
  - CHANGELOG 0.1.0 e CONTRIBUTING.md.
  - Workflow `release.yml`: ao receber uma tag `vX.Y.Z`, roda os testes e publica no Marketplace e no Open VSX (segredos `VSCE_PAT` e `OVSX_PAT`).
- **Corrigido durante a captura:**
  - O HTML das fórmulas vinha do KaTeX 0.16 (cópia interna do `@vscode/markdown-it-katex`) com o CSS do 0.19, e os subscritos saíam desalinhados no preview e no PDF. Agora o plugin recebe o KaTeX 0.19, e um `overrides` do npm remove a cópia antiga.
  - No tema `auto`, um documento curto deixava uma faixa com a cor do GitHub abaixo do conteúdo.

### Fase 5: Opcional / futuro

- Editor WYSIWYG via `CustomTextEditorProvider` (Milkdown ou Tiptap), sincronizado com o `TextDocument`.
- Exportar DOCX e HTML standalone.
- ~~Mermaid e KaTeX rasterizados dentro do RTF.~~ (feito na Fase 2)

**Estimativa total da v1:** cerca de 3 a 4 semanas para uma pessoa.

---

## 8. Estratégia de testes

- **Unitários (vitest):** `MarkdownEngine` (snapshot do HTML), `RtfRenderer` (golden files), `tableFormatter`, `toc`, `rtfEscape` (Unicode, chaves, barras).
- **Integração (`@vscode/test-electron`):** ativação, abertura do preview, execução dos comandos de exportação gerando arquivo não vazio, edições de formatação.
- **Manual / visual:** checklist de fixtures (`test/fixtures/kitchen-sink.md`) nos três SOs e nos temas claro e escuro.

---

## 9. Riscos e mitigações

| Risco                                                    | Mitigação                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Nenhum Chrome/Edge na máquina (Linux mínimo)             | Mensagem com instruções + `executablePath`; opcionalmente baixar Chromium sob demanda (`@puppeteer/browsers`) com consentimento |
| Tamanho do `.vsix` (shiki, mermaid, katex)               | Bundle separado para o webview, carregamento sob demanda de linguagens do shiki, `.vscodeignore` rigoroso                       |
| RTF com layout limitado (tabelas complexas, imagens SVG) | Documentar limitações; rasterizar SVG; opção Pandoc                                                                             |
| HTML malicioso no `.md` (XSS no webview)                 | `allowHtml=false` por padrão, DOMPurify, CSP com nonce, Workspace Trust                                                         |
| Performance em arquivos grandes (> 1 MB)                 | Debounce adaptativo, renderização incremental por bloco (futuro), desligar Mermaid acima de um limite                           |
| Conflito de atalhos (`Ctrl+B` abre a sidebar)            | Atalhos sempre com `when: editorTextFocus && editorLangId == markdown`                                                          |

---

## 10. Decisões

1. **Nome e publisher:** `JefersonPontes.md-tool`, exibido como "MD tool".
2. **Idioma da UI:** pt-BR e en desde a v1.
3. **WYSIWYG:** fica para a Fase 5; o editor nativo com o preview atende a v1.
4. **Download automático de Chromium:** não; só o navegador do sistema ou `mdTool.pdf.executablePath`.
5. **Licença:** MIT.
6. **Repositório:** https://github.com/fcojefersonpontes/md-tool
