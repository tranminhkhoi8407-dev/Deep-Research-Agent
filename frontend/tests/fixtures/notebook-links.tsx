/* Real components; isolated in-memory document and live transport only. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BlockNoteEditor } from '@blocknote/core';
import { blocksToYDoc } from '@blocknote/core/yjs';
import * as Y from 'yjs';
import LiveResearchEditor, { type NotebookOperation } from '../../src/LiveResearchEditor';
import { NotebookSources } from '../../src/NotebookTools';
import '../../src/styles.css';
import '../../src/design.css';
import '../../src/dark-mode.css';
import '../../src/CollaborationHub.css';
const params = new URLSearchParams(location.search), language = params.get('lang') === 'vi' ? 'vi' : 'en';
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const pages = [
  { id: 'a'.repeat(32), title: 'ff', parent_id: null },
  { id: 'b'.repeat(32), title: '12', parent_id: null },
  { id: 'c'.repeat(32), title: '124', parent_id: null },
  { id: 'd'.repeat(32), title: 'A deliberately long page title to verify readable truncation without breaking the source panel layout', parent_id: null },
];
const qa = { inserted: '', opened: '', createdUnder: '', blocks: [] as unknown[] };
Object.assign(window, { notebookLinksQA: qa });
const seedEditor = BlockNoteEditor.create();
const doc = blocksToYDoc(seedEditor, [{ type: 'paragraph', content: '' }], 'notebook');
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.startsWith('/__notebook-links-fixture/')) return nativeFetch(input, init);
  if (url.pathname.endsWith('/document')) return new Response(JSON.stringify({ format: 'blocks', revision: 0, update: encode(Y.encodeStateAsUpdate(doc)), legacy_markdown: '' }));
  if (url.pathname.endsWith('/projection')) return new Response('{}');
  return new Response('{}', { status: 404 });
};
class FixtureSocket {
  static OPEN = 1; readyState = 1; revision = 0;
  onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null;
  constructor() { setTimeout(() => { this.onopen?.(); this.message({ type: 'ready', access: 4, format: 'blocks', revision: 0 }); }, 30); }
  message(value: object) { this.onmessage?.({ data: JSON.stringify(value) }); }
  send(raw: string) { const value = JSON.parse(raw); if (value.type === 'update') { Y.applyUpdate(doc, Uint8Array.from(atob(value.data), char => char.charCodeAt(0))); setTimeout(() => { this.message({ type: 'update', data: value.data, seq: ++this.revision }); this.message({ type: 'ack', id: value.id, revision: this.revision }); }, 30); } }
  close() { this.readyState = 3; }
}
window.WebSocket = FixtureSocket as unknown as typeof WebSocket;
function Fixture() {
  const [operation, setOperation] = useState<NotebookOperation>({ id: 1, mode: 'replace', content: '', blocks: [
    { id: 'default-page-link', type: 'pageLink', props: { pageId: pages[2].id, title: pages[2].title, backgroundColor: 'default', textColor: 'default' }, children: [] },
    { id: 'custom-page-link', type: 'pageLink', props: { pageId: pages[1].id, title: pages[1].title, backgroundColor: 'purple', textColor: 'purple' }, children: [] },
    { id: 'plain-note', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'ff', styles: {} }], children: [] },
  ] as NotebookOperation['blocks'] });
  return <main className="notebook-links-qa"><section><small>Mathematics · Updated Oct 13, 2026</small><h1>{language === 'vi' ? 'Phương pháp' : 'Methodology'}</h1><LiveResearchEditor apiBase="/__notebook-links-fixture" pageId={'e'.repeat(32)} userId="links-qa" language={language} canEdit onReady={() => {}} onSync={() => {}} onBlocks={blocks => { qa.blocks = blocks; }} operation={operation} pages={pages} onOpenPage={id => { qa.opened = id; }} onCreateSubpageUnder={id => { qa.createdUnder = id; }} /></section><aside><NotebookSources language={language} references={{ pages, evidence: [], backlinks: [pages[0]] }} canEdit body="" onInsert={content => { qa.inserted = content; setOperation({ id: Date.now(), mode: 'append', content }); }} onOpen={id => { qa.opened = id; }} /></aside></main>;
}
const style = document.createElement('style');
style.textContent = '.notebook-links-qa{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:36px;max-width:1180px;margin:36px auto;padding:0 24px;color:var(--ink)}.notebook-links-qa>section{min-width:0}.notebook-links-qa>section>small{color:var(--muted)}.notebook-links-qa h1{font-size:28px;margin:16px 0 28px}.notebook-links-qa>aside{min-width:0;background:var(--surface-soft);border:1px solid var(--line);border-radius:16px;padding:20px}.notebook-links-qa .notebook-sources{padding:0}.notebook-links-qa .bn-container{padding:0}.notebook-links-qa h3{font-size:16px}.notebook-links-qa p{font-size:12px;line-height:1.7}@media(max-width:740px){.notebook-links-qa{grid-template-columns:minmax(0,1fr);margin:22px auto;padding:0 16px;gap:22px}}';
document.head.appendChild(style);
createRoot(document.getElementById('root')!).render(<Fixture />);
