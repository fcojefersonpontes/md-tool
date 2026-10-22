# Changelog

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
