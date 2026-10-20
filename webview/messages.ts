/** Messages exchanged between the extension host and the preview webview. */

export type HostMessage = { type: 'update'; html: string } | { type: 'scrollTo'; line: number };

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'revealLine'; line: number }
  | { type: 'openLink'; href: string }
  | { type: 'toggleTask'; line: number };

/** Persisted by the webview so the panel can be restored after a reload. */
export interface PreviewState {
  uri: string;
  line?: number;
}
