import MarkdownIt from 'markdown-it';
import type { PluginSimple, PluginWithOptions, StateBlock, StateCore, Token } from 'markdown-it';
import markdownItFootnote from 'markdown-it-footnote';
import markdownItFrontMatter from 'markdown-it-front-matter';
import markdownItKatex from '@vscode/markdown-it-katex';
import type { HighlighterCore } from 'shiki/core';
import { escapeHtml } from './html';
import { getHighlighter, highlight } from './highlighter';
import { Slugger } from './slugify';

export interface EngineOptions {
  /** Allow raw HTML in the source. Output must still be sanitized by the consumer. */
  allowHtml: boolean;
  math: boolean;
  mermaid: boolean;
}

export interface RenderOptions {
  /** Maps an image `src` (as written in the source, URL-encoded) to a loadable URL. */
  resolveResource?: (src: string) => string;
}

export interface Heading {
  level: number;
  text: string;
  slug: string;
  /** Zero-based source line. */
  line: number;
}

export type { Token };

export interface ParseResult {
  tokens: Token[];
  headings: Heading[];
  frontMatter?: string;
}

export interface RenderResult {
  html: string;
  headings: Heading[];
  frontMatter?: string;
}

interface RenderEnv extends RenderOptions {
  headings: Heading[];
  frontMatter?: string;
}

/**
 * Single Markdown pipeline shared by the preview and the exporters.
 * Block elements carry `data-line` (zero-based source line) for scroll sync.
 */
export class MarkdownEngine {
  private readonly md: MarkdownIt;

  private constructor(
    readonly options: EngineOptions,
    private readonly highlighter: HighlighterCore,
  ) {
    this.md = new MarkdownIt({ html: options.allowHtml, linkify: true });
    // The plugins' bundled typings target the CJS flavour of @types/markdown-it.
    this.md.use(
      markdownItFrontMatter as unknown as PluginWithOptions<(meta: string) => void>,
      () => {},
    );
    this.md.use(markdownItFootnote as unknown as PluginSimple);
    if (!options.allowHtml) {
      // Keep `<!-- comments -->` (e.g. TOC markers) invisible even with raw HTML disabled.
      // Before 'lheading': a setext heading would otherwise swallow the comment line.
      this.md.block.ruler.before('lheading', 'md_tool_comment', commentBlockRule, {
        alt: ['paragraph', 'reference', 'blockquote', 'list'],
      });
    }
    if (options.math) {
      this.md.use(markdownItKatex, { enableFencedBlocks: true, throwOnError: false });
    }
    this.md.core.ruler.after('inline', 'md_tool_headings', headingRule);
    this.md.core.ruler.after('inline', 'md_tool_task_lists', taskListRule);
    this.md.core.ruler.push('md_tool_source_lines', sourceLineRule);
    this.installRenderers();
  }

  static async create(options: EngineOptions): Promise<MarkdownEngine> {
    return new MarkdownEngine(options, await getHighlighter());
  }

  /** Token stream for consumers that do not emit HTML (e.g. the RTF exporter). */
  parse(text: string): ParseResult {
    const env: RenderEnv = { headings: [] };
    const tokens = this.md.parse(text, env);
    const frontMatter = tokens.find((token) => token.type === 'front_matter')?.meta as
      string | undefined;
    return { tokens, headings: env.headings, frontMatter };
  }

  render(text: string, options: RenderOptions = {}): RenderResult {
    const env: RenderEnv = { ...options, headings: [] };
    const tokens = this.md.parse(text, env);
    const html = this.md.renderer.render(tokens, this.md.options, env);
    return { html, headings: env.headings, frontMatter: env.frontMatter };
  }

  private installRenderers(): void {
    const rules = this.md.renderer.rules;

    rules.html_comment = () => '';

    rules.front_matter = (tokens, idx, _opts, env) => {
      (env as RenderEnv).frontMatter = tokens[idx].meta as string;
      return '';
    };

    const defaultFence = rules.fence!;
    rules.fence = (tokens, idx, opts, env, self) => {
      const token = tokens[idx];
      const lang = token.info.trim().split(/\s+/)[0].toLowerCase();
      const lineAttr = dataLineAttr(token);
      if (lang === 'mermaid' && this.options.mermaid) {
        return `<pre class="mermaid"${lineAttr}>${escapeHtml(token.content)}</pre>\n`;
      }
      const highlighted = lang ? highlight(this.highlighter, token.content, lang) : undefined;
      if (highlighted) {
        return highlighted.replace(/^<pre\b/, `<pre${lineAttr}`) + '\n';
      }
      return defaultFence(tokens, idx, opts, env, self);
    };

    const defaultImage = rules.image!;
    rules.image = (tokens, idx, opts, env, self) => {
      const token = tokens[idx];
      const src = token.attrGet('src');
      const { resolveResource } = env as RenderEnv;
      if (src && resolveResource) token.attrSet('src', resolveResource(src));
      return defaultImage(tokens, idx, opts, env, self);
    };

    rules.task_checkbox = (tokens, idx) => {
      const { checked, line } = tokens[idx].meta as { checked: boolean; line: number };
      return (
        `<input type="checkbox" class="task-list-item-checkbox" data-line="${line}"` +
        `${checked ? ' checked' : ''}> `
      );
    };
  }
}

function dataLineAttr(token: Token): string {
  return token.map ? ` data-line="${token.map[0]}"` : '';
}

/** Adds `data-line` to every block-level opening token that maps to source lines. */
/** Block made only of an HTML comment (possibly multi-line), emitted as a hidden token. */
function commentBlockRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const start = state.bMarks[startLine] + state.tShift[startLine];
  if (!state.src.startsWith('<!--', start)) return false;

  let line = startLine;
  for (; line < endLine; line++) {
    const from = line === startLine ? start + 4 : state.bMarks[line] + state.tShift[line];
    const close = state.src.slice(from, state.eMarks[line]).indexOf('-->');
    if (close !== -1) {
      // Only a comment on its own: `<!-- a --> text` is left to the paragraph rule.
      if (state.src.slice(from + close + 3, state.eMarks[line]).trim()) return false;
      break;
    }
  }
  if (line === endLine) return false;
  if (silent) return true;

  const token = state.push('html_comment', '', 0);
  token.map = [startLine, line + 1];
  token.content = state.getLines(startLine, line + 1, state.blkIndent, false);
  state.line = line + 1;
  return true;
}

function sourceLineRule(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.map && token.nesting !== -1 && token.type !== 'inline') {
      token.attrSet('data-line', String(token.map[0]));
    }
  }
}

/** Assigns unique GitHub-style ids to headings and records them in the env. */
function headingRule(state: StateCore): void {
  const slugger = new Slugger();
  const env = state.env as RenderEnv;
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'heading_open') continue;
    const text = inlineText(tokens[i + 1]);
    const slug = slugger.slug(text);
    token.attrSet('id', slug);
    env.headings?.push({
      level: Number(token.tag.slice(1)),
      text,
      slug,
      line: token.map?.[0] ?? 0,
    });
  }
}

function inlineText(token: Token | undefined): string {
  if (!token?.children) return token?.content ?? '';
  return token.children
    .filter((child) => child.type === 'text' || child.type === 'code_inline')
    .map((child) => child.content)
    .join('');
}

const TASK_MARKER = /^\[([ xX])\](?=\s|$)\s?/;

/** Turns `- [ ] item` / `- [x] item` list items into checkboxes (GFM task lists). */
function taskListRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    const listItem = tokens[i - 2];
    if (
      inline.type !== 'inline' ||
      tokens[i - 1].type !== 'paragraph_open' ||
      listItem.type !== 'list_item_open'
    ) {
      continue;
    }
    const first = inline.children?.[0];
    const match = first?.type === 'text' ? TASK_MARKER.exec(first.content) : null;
    if (!first || !match) continue;

    first.content = first.content.slice(match[0].length);
    const checkbox = new state.Token('task_checkbox', 'input', 0);
    checkbox.meta = { checked: match[1] !== ' ', line: listItem.map?.[0] ?? 0 };
    inline.children!.unshift(checkbox);

    listItem.attrJoin('class', 'task-list-item');
    for (let j = i - 3; j >= 0; j--) {
      const list = tokens[j];
      if (
        list.level === listItem.level - 1 &&
        (list.type === 'bullet_list_open' || list.type === 'ordered_list_open')
      ) {
        if (!list.attrGet('class')?.includes('contains-task-list')) {
          list.attrJoin('class', 'contains-task-list');
        }
        break;
      }
    }
  }
}
