# Changelog

## 0.3.3

- Exported text wraps like the preview: by default (`mdTool.export.fontSize` empty) the body
  size is chosen so a line holds as much text as the preview at full width, about 8 pt on A4
  with 20 mm margins. A heading that takes two lines in the preview takes two in the PDF and
  the RTF. Set a number to fix the size. The ABNT profile keeps its 12 pt.
- Tables: columns are sized like a browser does. Short cells stay on one line, long text wraps
  in its own column, and only very long words (code, URLs) break. PDF and RTF size columns the
  same way.

## 0.3.2

- PDF and RTF exports use the preview's text size: `mdTool.export.fontSize` now defaults to
  10.5 pt (the preview's 14 px) instead of 11 pt. The ABNT profile keeps its 12 pt.
- RTF: table columns leave room for bold headers, which no longer wrap mid-word.

## 0.3.1

- Documentation: the ABNT examples use generic sample data.

## 0.3.0

### ABNT profile

- A second layout for exported PDF and RTF files: a formal document following the Brazilian
  ABNT rules (NBR 14724, NBR 6024, NBR 10520). Choose it with `mdTool.export.profile: "abnt"`,
  or per document with `perfil: abnt` in the front matter.
- A4 with 3 cm top and left and 2 cm bottom and right margins, Times New Roman 12 pt (or the
  configured family), black text, justified 1.5-spaced paragraphs with a 1.25 cm first-line
  indent, and page numbers in the top right corner.
- `#` is the document title, centered in upper case, with the subtitle, author, place and date
  from the front matter below it. `##` to `######` are sections numbered automatically
  (`1`, `1.1`, `1.1.1`...), each level with its own emphasis. REFERÊNCIAS, ANEXO, APÊNDICE and
  headings ending in `{.unnumbered}` are centered without a number.
- Lists become alíneas `a)`, `b)` with `–` subalíneas; quotes become long quotations (4 cm
  indent, 10 pt, single-spaced); footnotes go to the foot of the page, under a 5 cm rule.
- Figures and tables get an identification above (`Figura 1 – ...`, `Tabela 1 – ...`) and a
  source below: write `Tabela: title` before a table and `Fonte: ...` after it, or use an
  image's alt text and title. Tables are drawn IBGE style (`Tabela`) or fully ruled (`Quadro`).
- The export warns when a figure or table has no source, or when a heading skips a level.
- The `abnt:` front-matter block changes the details: `lista_nao_ordenada`, `hr`,
  `tabela_padrao`, `primeira_pagina_visivel`, `secao_primaria_nova_pagina`,
  `numeracao_secoes`.

### Changes

- The editor title has two preview buttons with their own icons, so they no longer look like
  VS Code's built-in Markdown preview: **Open Preview** (book) shows it in place of the editor,
  in the same group, and **Open Preview to the Side** keeps working as before. In a preview,
  **Show Markdown Source** goes back to the file.
- The preview text is smaller: 14 px instead of 16 px, like VS Code's own Markdown preview.
- `mdTool.export.fontFamily` and `codeFontFamily` accept a comma-separated list; the first
  installed family is used.
- The RTF viewer shows line spacing.

## 0.2.0

### Export without a browser

- **PDF** and **RTF** are now written entirely by the extension: Chrome, Edge or Chromium are
  no longer needed, so exports can't fail because a browser is missing, updating or blocked.
- PDF: selectable text, internal and external links, a bookmark per heading, highlighted code,
  and formulas, Mermaid diagrams and SVG images as vectors. Your system fonts are embedded,
  with fallbacks for symbols and CJK.
- Formulas are typeset with MathJax; Mermaid diagrams are drawn by VS Code in a temporary panel
  that closes by itself.
- RTF: formulas, diagrams and SVG/GIF/WebP images are converted to PNG inside the extension.
- When an export fails, "Show Details" opens the "MD tool" output channel.

### PDF and RTF viewer

- A simple viewer to check exported files without leaving VS Code: **Preview** in the export
  notification, **Open in PDF / RTF Viewer** in the Explorer, or **Reopen Editor With…** on any
  `.pdf` or `.rtf` file. It reloads when the file changes.
- PDF pages are drawn by pdf.js, with selectable text, links and zoom.
- RTF is read by the extension: formatting, headings, lists, tables, links, footnotes and
  PNG/JPEG pictures.

### Settings

- New: `mdTool.export.fontFamily`, `mdTool.export.codeFontFamily` and `mdTool.export.fontSize`
  (PDF and RTF), and `mdTool.pdf.header` / `mdTool.pdf.footer`: plain text with `{page}`,
  `{pages}`, `{title}` and `{date}`. Front matter accepts `pdf: header` / `footer`.
- Removed: `mdTool.pdf.executablePath`, `mdTool.pdf.headerTemplate`,
  `mdTool.pdf.footerTemplate` and `mdTool.rtf.*`.

### Changes

- The PDF follows its own GitHub-like layout instead of printing the preview; custom
  stylesheets apply to the preview only. Emoji are monochrome in the PDF.

### Fixes

- Exporting from the preview's title buttons failed with "cannot open webview-panel:…".

## 0.1.0

First public release.

### Preview

- Live preview beside the editor, with synchronized scrolling in both directions.
- GitHub-flavored Markdown: tables, clickable task lists, footnotes, hidden front matter.
- Syntax highlighting (GitHub light and dark themes), KaTeX math and Mermaid diagrams.
- Relative links open in the editor (including `file.md#section`); relative images load.
- Automatic, light or dark theme, and custom stylesheets.
- Strict Content Security Policy, sanitized HTML and Workspace Trust support.

### Export

- **PDF** through the installed Chrome, Edge or Chromium, matching the preview: page size,
  orientation, margins, header and footer with page numbers, and per-document options in the
  front matter (`pdf:`).
- **RTF** written by the extension: headings with outline levels and bookmarks, links, lists,
  tasks, tables, code, quotes, footnotes and PNG/JPEG images. Formulas, Mermaid diagrams and
  SVG/GIF/WebP images are rendered by the browser and embedded as PNG.
- Commands in the editor, the Explorer and the preview; cancellable progress and
  "Open" / "Show in Folder" afterwards.

### Editing

- Toggle bold, italic, strikethrough, inline code and code blocks, with multiple cursors.
- Insert link (suggests the URL in the clipboard; a selected URL becomes a link).
- Table formatter, also used by Format Document, with correct widths for CJK and emoji.
- Table of contents between `<!-- toc -->` and `<!-- tocstop -->`, refreshed on save.
- Enter continues bullet, numbered and task lists and block quotes; on an empty item it ends
  the list.

### Other

- English and Brazilian Portuguese interface.
- No telemetry.
