// Notion's typing shortcut is deliberately double-dollar, not a currency sign.
export const inlineEquationInput = /(?<![\\$])\$\$([^$\n]+)\$\$$/;
export function inlineEquationParts(text: string) {
  const parts: ({ type: 'text'; text: string } | { type: 'math'; content: string })[] = [];
  const pattern = /(?<![\\$])\$\$([^$\n]+)\$\$(?!\$)/g;
  let from = 0;
  for (const match of text.matchAll(pattern)) {
    if (!match[1].trim()) continue;
    if (match.index! > from) parts.push({ type: 'text', text: text.slice(from, match.index) });
    parts.push({ type: 'math', content: match[1].trim() });
    from = match.index! + match[0].length;
  }
  if (from < text.length) parts.push({ type: 'text', text: text.slice(from) });
  return parts;
}

type Inline = { type: string; text?: string; content?: string | Inline[] };
export function equationSource(content: string | Inline[] | undefined): string {
  if (typeof content === 'string') return content;
  return (content || []).map(item => item.type === 'text' ? item.text || '' : equationSource(item.content)).join('');
}

export function blockTextStats(block: { content?: unknown; props?: Record<string, unknown>; type?: string }) {
  const read = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(read).join('');
    if (!value || typeof value !== 'object') return '';
    const item = value as Record<string, unknown>;
    if (typeof item.text === 'string') return item.text;
    if (item.type === 'tableContent') return (item.rows as { cells: unknown[] }[]).map(row => row.cells.map(read).join(' ')).join('\n');
    return read(item.content);
  };
  const text = block.type === 'pageLink' ? String(block.props?.title || '') : read(block.content);
  return { words: text.trim() ? text.trim().split(/\s+/u).length : 0, characters: [...text].length };
}

// Do not reuse CRDT block IDs when duplicating a nested branch.
export function freshBlockCopy<T extends { id?: string; children?: T[] }>(block: T): T extends unknown ? Omit<T, 'id'> : never {
  const { id: _id, children, ...rest } = block;
  return { ...rest, ...(children ? { children: children.map(child => freshBlockCopy(child)) } : {}) } as T extends unknown ? Omit<T, 'id'> : never;
}

// The generic HTML-to-Markdown exporter can omit custom math nodes. Project
// them to unique text tokens, then restore raw LaTeX after Markdown escaping.
// This is an export-only copy: the collaborative document is never changed.
export function mathMarkdownProjection<T>(blocks: T[], nonce: string) {
  const equations: [string, string][] = [];
  const token = (source: string, display: boolean) => {
    const key = `NEXORAEQUATION${nonce.replace(/[^a-z0-9]/gi, '')}${equations.length}END`;
    equations.push([key, display ? `$$\n${source}\n$$` : `$$${source}$$`]);
    return { type: 'text', text: key, styles: {} };
  };
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const row = value as Record<string, unknown>;
    if (row.type === 'pageLink') {
      const props = row.props as { pageId?: string; title?: string };
      return { ...row, type: 'paragraph', props: {}, content: [{ type: 'link', href: `#/collab/page/${props.pageId}`, content: [{ type: 'text', text: props.title || 'Untitled', styles: {} }] }], children: visit(row.children) };
    }
    if (row.type === 'math') return token(equationSource(row.content as string | Inline[]), false);
    if (row.type === 'mathBlock') return {
      ...row, type: 'paragraph', props: {},
      content: [token(equationSource(row.content as string | Inline[]), true)],
      children: visit(row.children),
    };
    return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, visit(item)]));
  };
  return {
    blocks: visit(blocks) as T[],
    restore: (markdown: string) => equations.reduce((text, [key, source]) => text.split(key).join(source), markdown),
  };
}
