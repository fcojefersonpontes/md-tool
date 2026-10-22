/** Messages exchanged between the extension host and the preview webview. */

export type HostMessage = { type: 'update'; html: string } | { type: 'scrollTo'; line: number };

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'revealLine'; line: number }
  | { type: 'openLink'; href: string }
  | { type: 'toggleTask'; line: number };

/** Extension host -> diagram webview (exports). */
export type DiagramHostMessage = { type: 'render'; id: number; source: string };

/** Diagram webview -> extension host. */
export type DiagramWebviewMessage =
  | { type: 'ready' }
  | { type: 'rendered'; id: number; svg: string }
  | { type: 'failed'; id: number; error: string };

/** An RTF document converted to HTML by the extension host; lengths in CSS pixels. */
export interface RtfPage {
  html: string;
  page: {
    width: number;
    height: number;
    margin: { top: number; right: number; bottom: number; left: number };
  };
}

/** Extension host -> document viewer (PDF / RTF). */
export type ViewerHostMessage =
  | { type: 'pdf'; data: Uint8Array }
  | { type: 'rtf'; document: RtfPage }
  | { type: 'error'; message: string };

/** Document viewer -> extension host. */
export type ViewerWebviewMessage =
  | { type: 'ready' }
  | { type: 'openLink'; href: string }
  | { type: 'rendered'; pages: number }
  | { type: 'failed'; error: string };

/** Persisted by the webview so the panel can be restored after a reload. */
export interface PreviewState {
  uri: string;
  line?: number;
}
