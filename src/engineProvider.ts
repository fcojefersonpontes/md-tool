import type * as vscode from 'vscode';
import { getEngineOptions } from './config';
import { MarkdownEngine } from './core/MarkdownEngine';

/** Shares one Markdown engine between previews and exporters, recreated when its options change. */
export class EngineProvider {
  private cached: { key: string; engine: Promise<MarkdownEngine> } | undefined;

  get(scope: vscode.Uri): Promise<MarkdownEngine> {
    const options = getEngineOptions(scope);
    const key = JSON.stringify(options);
    if (this.cached?.key !== key) this.cached = { key, engine: MarkdownEngine.create(options) };
    return this.cached.engine;
  }
}
