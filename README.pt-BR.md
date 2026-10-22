# MD tool

Visualize, edite e exporte Markdown para **PDF** e **RTF** sem sair do VS Code.

[Read in English](README.md)

![Editor e preview ao vivo lado a lado](docs/images/preview.png)

## Funcionalidades

- **Preview ao vivo** ao lado do editor (`Ctrl+K Alt+V`), com rolagem sincronizada.
- Markdown no estilo GitHub: tabelas, listas de tarefas clicáveis, notas de rodapé, front matter.
- Realce de código, fórmulas **KaTeX** e diagramas **Mermaid**.
- Segue o tema do VS Code, ou fica sempre claro ou escuro; aceita CSS próprio por cima.
- **Exportar para PDF** com o Chrome, Edge ou Chromium que você já tem, igual ao preview.
- **Exportar para RTF**, para Word e LibreOffice, com fórmulas e diagramas embutidos como imagem.
- **Atalhos de edição**: negrito, itálico, tachado e código (com vários cursores), links,
  formatação de tabelas, sumário e continuação de listas no Enter.

![Fórmulas e diagramas no preview](docs/images/preview-math.png)

## Exportação

Use **Exportar para PDF** ou **Exportar para RTF** no menu de contexto do editor, no Explorer,
na barra do preview ou na Paleta de Comandos. O arquivo é gravado ao lado do Markdown (veja
`mdTool.export.outputDir`), e uma notificação oferece abrir o arquivo ou mostrá-lo na pasta.

![Notificação de exportação](docs/images/export.png)

O mesmo documento, exportado:

![O PDF exportado e o RTF aberto no LibreOffice Writer](docs/images/outputs.png)

O **PDF** precisa do Google Chrome, do Microsoft Edge ou do Chromium instalado. Nada é baixado:
a extensão encontra o navegador sozinha ou usa `mdTool.pdf.executablePath`.

O **RTF** é gerado pela própria extensão. Fórmulas, diagramas Mermaid e imagens SVG/GIF/WebP são
desenhados pelo mesmo navegador e embutidos como PNG. Sem navegador, saem como texto (TeX,
código do diagrama, texto alternativo), com um aviso.

### Opções por documento

O front matter pode sobrescrever as opções do PDF:

```yaml
---
title: Relatório trimestral
pdf:
  format: Letter
  landscape: true
  margin: 15mm 20mm
  headerTemplate: '<div style="font-size:9px;width:100%;text-align:center"><span class="title"></span></div>'
---
```

## Edição

![Listas continuam no Enter, Ctrl+B e formatação de tabela](docs/images/editing.gif)

| Comando                                            | Atalho                             | O que faz                                                                                 |
| -------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| Alternar Negrito / Itálico                         | `Ctrl+B` / `Ctrl+I`                | Envolve a seleção (ou a palavra sob o cursor) em `**` / `_`; de novo, remove              |
| Alternar Tachado / Código Inline / Bloco de Código | menu de contexto                   | `~~`, `` ` `` e bloco cercado por três crases                                             |
| Inserir Link                                       | `Ctrl+K L`                         | Pede o endereço (sugere a URL da área de transferência); URL selecionada vira link direto |
| Formatar Tabelas                                   | `Shift+Alt+F` (Formatar Documento) | Alinha as colunas, respeitando acentos, CJK e emoji                                       |
| Inserir / Atualizar Sumário                        | menu de contexto                   | Lista os títulos entre `<!-- toc -->` e `<!-- tocstop -->`; atualiza ao salvar            |
| Enter numa lista                                   | `Enter`                            | Continua `-`, `1.`, `- [ ]` e `>`; num item vazio, encerra a lista                        |

No macOS, use `Cmd` no lugar de `Ctrl`. Os atalhos valem só em arquivos Markdown, e todos os
comandos ficam no submenu **Markdown (MD tool)** do menu de contexto do editor.

Outline, recolhimento de seções, completar caminhos e colar ou arrastar imagens já vêm no suporte
a Markdown do próprio VS Code, e o MD tool não mexe neles. Para salvar as imagens coladas numa
pasta `assets/` ao lado do documento:

```json
"markdown.copyFiles.destination": { "**/*.md": "${documentDirName}/assets/${fileName}" }
```

## Configurações

| Chave                              | Padrão           | Descrição                                    |
| ---------------------------------- | ---------------- | -------------------------------------------- |
| `mdTool.preview.theme`             | `auto`           | `auto` (segue o VS Code), `light` ou `dark`  |
| `mdTool.preview.customCss`         | `[]`             | Folhas de estilo extras no preview e no PDF  |
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
| `mdTool.editor.formatTables`       | `true`           | Registrar o formatador de tabelas            |
| `mdTool.toc.minLevel` / `maxLevel` | `2` / `3`        | Níveis de título incluídos no sumário        |
| `mdTool.toc.updateOnSave`          | `true`           | Atualizar o sumário ao salvar                |

## Segurança e privacidade

- O preview roda com uma Content Security Policy restrita, e todo HTML é sanitizado.
- Em [workspaces não confiáveis](https://code.visualstudio.com/docs/editor/workspace-trust),
  HTML bruto, folhas de estilo próprias e caminho de navegador personalizado ficam desativados.
- O MD tool **não coleta telemetria** e não faz requisições de rede por conta própria. Imagens
  remotas de um documento são carregadas pelo preview, como em qualquer visualizador de Markdown.

## Limitações conhecidas

- No RTF, fórmulas inline são rebaixadas até a linha de base com o comando `\dn`, que o
  LibreOffice ignora: nele, fórmulas com subscritos ou frações ficam um pouco acima da linha.
- A exportação para PDF e as imagens do RTF precisam de um navegador baseado em Chromium.

## Requisitos

VS Code 1.90 ou mais recente. Para PDF: Google Chrome, Microsoft Edge ou Chromium.

## Licença

[MIT](LICENSE). As licenças de terceiros estão em `THIRD-PARTY-NOTICES.txt`, dentro do pacote.
