# MD tool

Preview, edit and export Markdown to **PDF** and **RTF**, without leaving VS Code.

[Leia em português](README.pt-BR.md)

![Editor and live preview side by side](docs/images/preview.png)

## Features

- **Live preview** next to the editor (`Ctrl+K Alt+V`), with synchronized scrolling.
- GitHub-flavored Markdown: tables, clickable task lists, footnotes, front matter.
- Syntax highlighting, **KaTeX** math and **Mermaid** diagrams.
- Follows the VS Code theme, or always light or dark; your own CSS on top.
- **Export to PDF** and **RTF** (for Word and LibreOffice) with nothing else to install: no
  browser, no Pandoc, no LaTeX.
- PDFs with real text, links, bookmarks and vector formulas and diagrams.
- A simple **PDF and RTF viewer** to check the result without leaving VS Code.
- **Editing helpers**: bold, italic, strikethrough and code toggles (multi-cursor), links,
  table formatting, table of contents and list continuation on Enter.

![Formulas and diagrams in the preview](docs/images/preview-math.png)

## Export

Run **Export to PDF** or **Export to RTF** from the editor's context menu, the Explorer, the
preview's toolbar or the Command Palette. The file is written next to the Markdown file (see
`mdTool.export.outputDir`), and a notification lets you preview it, open it in its default app
or show it in its folder.

![Export notification](docs/images/export.png)

The same document, exported:

![The exported PDF and the RTF opened in LibreOffice Writer](docs/images/outputs.png)

Both formats are written by the extension itself, with your system fonts (embedded in the PDF):

- **PDF**: selectable text, clickable links (also to headings and footnotes), a bookmark per
  heading, page numbers, and formulas, diagrams and SVG images as vectors.
- **RTF**: headings with outline levels, lists, tables, code and footnotes; formulas, diagrams
  and SVG/GIF/WebP images are embedded as PNG pictures.

Formulas are typeset with MathJax. Mermaid diagrams are drawn by VS Code itself in a panel that
opens beside the editor for a moment during the export. An invalid formula or diagram is
exported as its source text, with a warning.

### Checking the result

**Preview** in the export notification opens the file in a simple viewer beside the editor. It
reloads when you export again, so it can stay open while you work on the document. To open any
`.pdf` or `.rtf` file in it, use **Open in PDF / RTF Viewer** in the Explorer's context menu or
**Reopen Editor With…**.

- **PDF**: pages drawn by pdf.js, with selectable text, working links and zoom.
- **RTF**: read by the extension itself: text formatting, headings, lists, tables, links,
  footnotes and PNG/JPEG pictures. It shows the content, but Word and LibreOffice may lay it out
  slightly differently. Other picture formats (EMF, WMF) appear as `[image]`.

### Per-document options

Front matter can override the PDF settings:

```yaml
---
title: Quarterly report
pdf:
  format: Letter
  landscape: true
  margin: 15mm 20mm
  header: '{title}'
  footer: 'Page {page} of {pages}'
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

| Setting                            | Default            | Description                                           |
| ---------------------------------- | ------------------ | ----------------------------------------------------- |
| `mdTool.preview.theme`             | `auto`             | `auto` (follows VS Code), `light` or `dark`           |
| `mdTool.preview.customCss`         | `[]`               | Extra stylesheets for the preview                     |
| `mdTool.preview.scrollSync`        | `true`             | Synchronize scrolling                                 |
| `mdTool.markdown.allowHtml`        | `false`            | Render raw HTML (sanitized)                           |
| `mdTool.markdown.math`             | `true`             | KaTeX math                                            |
| `mdTool.markdown.mermaid`          | `true`             | Mermaid diagrams                                      |
| `mdTool.export.outputDir`          | `${fileDirname}`   | Output folder (also accepts `${workspaceFolder}`)     |
| `mdTool.export.askLocation`        | `false`            | Ask where to save                                     |
| `mdTool.export.pageSize`           | `A4`               | `A4`, `Letter` or `Legal`                             |
| `mdTool.export.landscape`          | `false`            | Landscape orientation                                 |
| `mdTool.export.margin`             | `20mm`             | Page margins (CSS shorthand)                          |
| `mdTool.export.fontFamily`         | (system)           | Body font of PDF and RTF                              |
| `mdTool.export.codeFontFamily`     | (system)           | Code font of PDF and RTF                              |
| `mdTool.export.fontSize`           | `11`               | Body font size (pt)                                   |
| `mdTool.pdf.header`                | empty              | Header text: `{page}`, `{pages}`, `{title}`, `{date}` |
| `mdTool.pdf.footer`                | `{page} / {pages}` | Footer text (same placeholders)                       |
| `mdTool.editor.listContinuation`   | `true`             | Continue lists on Enter                               |
| `mdTool.editor.formatTables`       | `true`             | Register the table formatter for Markdown             |
| `mdTool.toc.minLevel` / `maxLevel` | `2` / `3`          | Heading levels in the table of contents               |
| `mdTool.toc.updateOnSave`          | `true`             | Refresh the table of contents on save                 |

## Security and privacy

- The preview runs with a strict Content Security Policy, and any HTML is sanitized.
- In [untrusted workspaces](https://code.visualstudio.com/docs/editor/workspace-trust), raw
  HTML and custom stylesheets are disabled.
- MD tool collects **no telemetry**. The only network requests are for remote images a document
  uses, in the preview and when exporting.
- Exporting runs no external program.

## Known limitations

- Inline formulas in RTF are lowered to the baseline with the RTF `\dn` command, which
  LibreOffice ignores: there, formulas with subscripts or fractions sit slightly above the line.
- The PDF follows a GitHub-like layout of its own: custom preview stylesheets do not apply to it.
- Emoji are drawn in a single color (PDF fonts cannot carry color glyphs).
- Raw HTML is left out of PDF and RTF, with a warning.

## Requirements

VS Code 1.90 or later. Nothing else.

## License

[MIT](LICENSE). Third-party licenses are in `THIRD-PARTY-NOTICES.txt` inside the package.
