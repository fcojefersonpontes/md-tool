# MD tool

Preview, edit and export Markdown to **PDF** and **RTF**, without leaving VS Code.

[Leia em português](README.pt-BR.md)

![Editor and live preview side by side](docs/images/preview.png)

## Features

- **Live preview** next to the editor (`Ctrl+K Alt+V`), with synchronized scrolling.
- GitHub-flavored Markdown: tables, clickable task lists, footnotes, front matter.
- Syntax highlighting, **KaTeX** math and **Mermaid** diagrams.
- Follows the VS Code theme, or always light or dark; your own CSS on top.
- **Export to PDF** with the Chrome, Edge or Chromium you already have, looking just like the preview.
- **Export to RTF** for Word and LibreOffice, with formulas and diagrams embedded as images.
- **Editing helpers**: bold, italic, strikethrough and code toggles (multi-cursor), links,
  table formatting, table of contents and list continuation on Enter.

![Formulas and diagrams in the preview](docs/images/preview-math.png)

## Export

Run **Export to PDF** or **Export to RTF** from the editor's context menu, the Explorer, the
preview's toolbar or the Command Palette. The file is written next to the Markdown file (see
`mdTool.export.outputDir`), and a notification lets you open it or show it in its folder.

![Export notification](docs/images/export.png)

The same document, exported:

![The exported PDF and the RTF opened in LibreOffice Writer](docs/images/outputs.png)

**PDF** needs Google Chrome, Microsoft Edge or Chromium installed. Nothing is downloaded: the
extension finds the browser, or uses `mdTool.pdf.executablePath`.

**RTF** is written by the extension itself. Formulas, Mermaid diagrams and SVG/GIF/WebP images
are drawn by the same browser and embedded as PNG; without a browser they fall back to their
source text (TeX, diagram code, alt text), with a warning.

### Per-document options

Front matter can override the PDF settings:

```yaml
---
title: Quarterly report
pdf:
  format: Letter
  landscape: true
  margin: 15mm 20mm
  headerTemplate: '<div style="font-size:9px;width:100%;text-align:center"><span class="title"></span></div>'
---
```

## Editing

![Lists continue on Enter, Ctrl+B and table formatting](docs/images/editing.gif)

| Command                             | Shortcut                        | What it does                                                                                |
| ----------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| Toggle Bold / Italic                | `Ctrl+B` / `Ctrl+I`             | Wraps the selection (or the word at the cursor) in `**` / `_`; again to remove it           |
| Toggle Strikethrough / Code / Block | context menu                    | `~~`, `` ` `` and a fenced code block                                                       |
| Insert Link                         | `Ctrl+K L`                      | Asks for the URL (suggests the one in the clipboard); a selected URL becomes a link at once |
| Format Tables                       | `Shift+Alt+F` (Format Document) | Aligns columns, counting accents, CJK and emoji correctly                                   |
| Insert / Update Table of Contents   | context menu                    | Lists the headings between `<!-- toc -->` and `<!-- tocstop -->`; refreshed on save         |
| Enter in a list                     | `Enter`                         | Continues `-`, `1.`, `- [ ]` and `>`; on an empty item, ends the list                       |

On macOS, use `Cmd` instead of `Ctrl`. The shortcuts only apply to Markdown files, and every
command is in the **Markdown (MD tool)** submenu of the editor's context menu.

Outline, folding, path completion and pasting or dropping images already come with VS Code's
built-in Markdown support, so MD tool leaves them alone. To save pasted images in an `assets/`
folder next to the document:

```json
"markdown.copyFiles.destination": { "**/*.md": "${documentDirName}/assets/${fileName}" }
```

## Settings

| Setting                            | Default          | Description                                       |
| ---------------------------------- | ---------------- | ------------------------------------------------- |
| `mdTool.preview.theme`             | `auto`           | `auto` (follows VS Code), `light` or `dark`       |
| `mdTool.preview.customCss`         | `[]`             | Extra stylesheets for the preview and the PDF     |
| `mdTool.preview.scrollSync`        | `true`           | Synchronize scrolling                             |
| `mdTool.markdown.allowHtml`        | `false`          | Render raw HTML (sanitized)                       |
| `mdTool.markdown.math`             | `true`           | KaTeX math                                        |
| `mdTool.markdown.mermaid`          | `true`           | Mermaid diagrams                                  |
| `mdTool.export.outputDir`          | `${fileDirname}` | Output folder (also accepts `${workspaceFolder}`) |
| `mdTool.export.askLocation`        | `false`          | Ask where to save                                 |
| `mdTool.export.pageSize`           | `A4`             | `A4`, `Letter` or `Legal`                         |
| `mdTool.export.landscape`          | `false`          | Landscape orientation                             |
| `mdTool.export.margin`             | `20mm`           | Page margins (CSS shorthand)                      |
| `mdTool.pdf.executablePath`        | (auto)           | Browser used for the PDF                          |
| `mdTool.pdf.headerTemplate`        | empty            | Header HTML                                       |
| `mdTool.pdf.footerTemplate`        | page number      | Footer HTML                                       |
| `mdTool.rtf.fontFamily`            | `Calibri`        | RTF body font                                     |
| `mdTool.rtf.codeFontFamily`        | `Consolas`       | RTF code font                                     |
| `mdTool.rtf.fontSize`              | `11`             | RTF font size (pt)                                |
| `mdTool.editor.listContinuation`   | `true`           | Continue lists on Enter                           |
| `mdTool.editor.formatTables`       | `true`           | Register the table formatter for Markdown         |
| `mdTool.toc.minLevel` / `maxLevel` | `2` / `3`        | Heading levels in the table of contents           |
| `mdTool.toc.updateOnSave`          | `true`           | Refresh the table of contents on save             |

## Security and privacy

- The preview runs with a strict Content Security Policy, and any HTML is sanitized.
- In [untrusted workspaces](https://code.visualstudio.com/docs/editor/workspace-trust), raw
  HTML, custom stylesheets and a custom browser path are disabled.
- MD tool collects **no telemetry** and makes no network requests of its own. Remote images in
  a document are loaded by the preview, like in any Markdown viewer.

## Known limitations

- Inline formulas in RTF are lowered to the baseline with the RTF `\dn` command, which
  LibreOffice ignores: there, formulas with subscripts or fractions sit slightly above the line.
- PDF export and the images in RTF need a Chromium-based browser installed.

## Requirements

VS Code 1.90 or later. For PDF: Google Chrome, Microsoft Edge or Chromium.

## License

[MIT](LICENSE). Third-party licenses are in `THIRD-PARTY-NOTICES.txt` inside the package.
