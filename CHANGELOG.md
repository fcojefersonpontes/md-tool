# Changelog

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
