import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as Y from "yjs";
import { BlockNoteEditor, BlockNoteSchema, createExtension, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { InputRule, inputRules } from '@handlewithcare/prosemirror-inputrules';
import { TextSelection } from 'prosemirror-state';
import { blocksToYDoc, withCollaboration } from "@blocknote/core/yjs";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import { createReactBlockSpec, useCreateBlockNote, getDefaultReactSlashMenuItems, SuggestionMenuController, SideMenuController, SideMenu, FormattingToolbarController, FormattingToolbar, blockTypeSelectItems } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { createReactInlineMathSpec, createReactMathBlockSpec, getMathSlashMenuItems, getMathBlockTypeSelectItems } from "@blocknote/math-block";
import { Wifi, WifiOff, FilePlus2, FileText, Plus } from "lucide-react";
import { equationSource, freshBlockCopy, inlineEquationInput, inlineEquationParts, mathMarkdownProjection } from './notebookMath';
import { NotebookBlockMenu } from './NotebookBlockMenu';
import type { Language } from "./ProductViews";
import type { Person } from "./CollaborationHub";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import './NotebookEditor.css';

const LegacyMarkdownEditor = lazy(() => import("./LegacyMarkdownEditor"));
const PageLinks = createContext<{ onOpen?: (id: string) => void; onCreateUnder?: (id: string) => void; language: Language; pages?: { id: string; title: string }[] }>({ language: 'en' });
const pageLinkSpec = createReactBlockSpec({ type: 'pageLink', propSchema: { pageId: { default: '' }, title: { default: '' } }, content: 'none' }, {
  render: ({ block }) => {
    const context = useContext(PageLinks), id = block.props.pageId;
    const title = context.pages?.find(page => page.id === id)?.title || block.props.title || 'Untitled';
    if (!/^[a-f0-9]{32}$/.test(id)) return <span>{title}</span>;
    return <div className="notebook-page-reference" contentEditable={false}>
      <a href={`#/collab/page/${id}`} onClick={event => { if (context.onOpen && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); context.onOpen(id); } }}><FileText size={18} /><span>{title}</span></a>
      {context.onCreateUnder && context.pages?.some(page => page.id === id) && <button type="button" aria-label={context.language === 'vi' ? `Tạo trang con trong ${title}` : `Create a subpage in ${title}`} title={context.language === 'vi' ? 'Tạo trang con' : 'Create subpage'} onClick={event => { event.stopPropagation(); context.onCreateUnder?.(id); }}><Plus size={17} /></button>}
    </div>;
  },
  toExternalHTML: ({ block }) => <a href={`#/collab/page/${block.props.pageId}`}>{block.props.title}</a>,
})();

// Media uploads are deliberately excluded: inserting a file must not publish it.
const { audio: _audio, video: _video, image: _image, file: _file, ...textBlocks } = defaultBlockSpecs;
const notionMathInput = createExtension({
  key: 'notebook-inline-equation',
  prosemirrorPlugins: [inputRules({ rules: [new InputRule(inlineEquationInput, (state, match, start, end) => {
    if (state.selection.$from.parent.type.spec.code || !match[1]?.trim()) return null;
    const node = state.schema.nodes.math.create(null, state.schema.text(match[1].trim()));
    const tr = state.tr.replaceRangeWith(start, end, node);
    return tr.setSelection(TextSelection.create(tr.doc, start + node.nodeSize));
  })] })],
});
const schema = BlockNoteSchema.create({
  // Disable the package's single-$ and $$-space shortcuts: they fire before
  // Notion's closing $$ and can turn a partially typed inline formula into a block.
  // BlockNote 0.55 registers spec extensions through blockSpecs only.
  blockSpecs: { ...textBlocks, pageLink: pageLinkSpec, mathBlock: { ...createReactMathBlockSpec(), extensions: [notionMathInput] } },
  inlineContentSpecs: { ...defaultInlineContentSpecs, math: { ...createReactInlineMathSpec(), extensions: [] } },
});
export type NotebookBlock = typeof schema.Block;
function parseNotebookMarkdown(editor: BlockNoteEditor<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>, source: string) {
  const blocks: ReturnType<typeof editor.tryParseMarkdownToBlocks> = [];
  let chunk: string[] = [], formula: string[] | null = null, fence = "";
  const convertInline = (block: NotebookBlock): NotebookBlock => {
    if (block.type !== 'codeBlock' && block.type !== 'mathBlock' && Array.isArray(block.content)) {
      block.content = block.content.flatMap(item => item.type === 'text' && !item.styles.code
        ? inlineEquationParts(item.text).map(part => part.type === 'text' ? { ...item, text: part.text } : { type: 'math' as const, props: {}, content: part.content }) : [item]) as typeof block.content;
    }
    block.children = block.children.map(convertInline);
    return block;
  };
  const flush = () => { if (chunk.length) blocks.push(...editor.tryParseMarkdownToBlocks(chunk.join("\n")).map(convertInline)); chunk = []; };
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!formula && /^(```|~~~)/.test(trimmed)) { const marker = trimmed.slice(0, 3); fence = fence ? (fence === marker ? "" : fence) : marker; }
    if (!fence && trimmed === "$$") {
      if (formula) { blocks.push({ id: crypto.randomUUID(), type: "mathBlock", props: {}, content: [{ type: "text", text: formula.join("\n"), styles: {} }], children: [] }); formula = null; }
      else { flush(); formula = []; }
    } else if (formula) formula.push(line);
    else chunk.push(line);
  }
  if (formula) chunk.push("$$", ...formula); // Unclosed formulas stay as text, never silently disappear.
  flush();
  return blocks;
}
export type NotebookOperation = { id: number; mode: "append" | "replace"; content: string; blocks?: NotebookBlock[] };
export type SubpageConversion = { title: string; update: string };
type DocumentResponse = { format: string; revision: number; update: string; legacy_markdown: string };
type Props = {
  apiBase: string; pageId: string; userId: string; username?: string; canEdit: boolean; language: Language;
  onReady: (markdown: string) => void; onSync: (synced: boolean) => void;
  onBlocks?: (blocks: NotebookBlock[]) => void; operation: NotebookOperation | null;
  onCreateSubpage?: () => void;
  onCreateSubpageUnder?: (pageId: string) => void;
  onConvertToPage?: (payload: SubpageConversion) => Promise<{ id: string; title: string }>;
  onOpenPage?: (id: string) => void; pages?: { id: string; title: string }[];
};
function encode(bytes: Uint8Array) {
  let result = "";
  for (const byte of bytes) result += String.fromCharCode(byte);
  return btoa(result);
}
function decode(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
async function documentRequest<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}/api/collab${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${response.status})`);
  }
  return response.json();
}

export default function LiveResearchEditor(props: Props) {
  const [state, setState] = useState<DocumentResponse | null>(null);
  const [error, setError] = useState("");
  const [converting, setConverting] = useState(false);
  const requestId = useRef(0);
  const load = async () => {
    const id = ++requestId.current;
    try {
      const result = await documentRequest<DocumentResponse>(props.apiBase, `/pages/${props.pageId}/document`);
      if (id === requestId.current) { setState(result); setError(""); }
    } catch (reason) { if (id === requestId.current) setError(String(reason)); }
  };
  useEffect(() => { void load(); return () => { requestId.current++; }; }, [props.apiBase, props.pageId]);
  const convert = async (source: DocumentResponse) => {
    setConverting(true); setError("");
    try {
      const importer = BlockNoteEditor.create({ schema });
      const blocks = source.legacy_markdown ? parseNotebookMarkdown(importer, source.legacy_markdown) : [{ type: "paragraph" as const, content: "" }];
      const seed = blocksToYDoc(importer, blocks, "notebook");
      try {
        await documentRequest(props.apiBase, `/pages/${props.pageId}/initialize-blocks`, { method: "POST", body: JSON.stringify({ expected_revision: source.revision, update: encode(Y.encodeStateAsUpdate(seed)) }) });
      } finally { seed.destroy(); }
      await load();
    } catch (reason) { setError(String(reason)); }
    finally { setConverting(false); }
  };
  // Empty pages bootstrap automatically; legacy pages require explicit consent.
  // Server-side compare-and-swap prevents duplicate imports by two collaborators.
  useEffect(() => { if (state?.format === "markdown" && !state.legacy_markdown && props.canEdit && !converting) void convert(state); }, [state]);
  if (error && !state) return <p role="alert" className="collab-inline-error">{error}<button onClick={() => void load()}>Retry</button></p>;
  if (!state) return <p role="status">{props.language === "vi" ? "Đang tải notebook…" : "Loading notebook…"}</p>;
  if (state.format !== 'blocks' && !state.legacy_markdown && props.canEdit) return <div role="status">{error ? <><p role="alert">{error}</p><button disabled={converting} onClick={() => void convert(state)}>Retry</button></> : props.language === 'vi' ? 'Đang chuẩn bị trang viết…' : 'Preparing your page…'}</div>;
  if (state.format !== "blocks") return <>
    <div className="notebook-upgrade">
      <strong>{props.language === "vi" ? "Nâng cấp trang Markdown sang editor dạng khối" : "Upgrade this Markdown page to the block editor"}</strong>
      <p>{props.language === "vi" ? "Bản gốc được giữ trong lịch sử. Bố cục Markdown đặc biệt có thể cần chỉnh lại; các thành viên cần tải lại trang sau khi chuyển." : "The original is kept in history. Special Markdown layouts may need adjustment; collaborators must reload after conversion."}</p>
      {props.canEdit && <button disabled={converting} onClick={() => void convert(state)}>{converting ? "…" : props.language === "vi" ? "Chuyển sang dạng khối" : "Convert to blocks"}</button>}
      {error && <p role="alert">{error}</p>}
    </div>
    {state.legacy_markdown && <Suspense fallback={<p role="status">Loading Markdown editor…</p>}><LegacyMarkdownEditor {...props} /></Suspense>}
  </>;
  return <BlockNotebook key={props.pageId} {...props} initial={state} />;
}

function BlockNotebook({ initial, ...props }: Props & { initial: DocumentResponse }) {
  const [doc] = useState(() => { const value = new Y.Doc(); Y.applyUpdate(value, decode(initial.update), "remote"); return value; });
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [presence, setPresence] = useState<Person[]>([]);
  const revision = useRef(initial.revision);
  const latest = useRef(props); latest.current = props;
  const syncedRef = useRef(false);
  const exportRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    let disposed = false, socket: WebSocket | null = null, timer: ReturnType<typeof setTimeout> | undefined;
    let flushTimer: ReturnType<typeof setTimeout> | undefined, retries = 0, allowed = false, readyConnected = false;
    let queued: Uint8Array[] = []; const pending = new Set<string>(); let acknowledgedRevision = initial.revision;
    const draftKey = `nexora-block-draft:${props.userId}:${props.pageId}`;
    const draft = () => { try { sessionStorage.setItem(draftKey, encode(Y.encodeStateAsUpdate(doc))); } catch { /* Optional recovery. */ } };
    const syncStatus = () => {
      syncedRef.current = readyConnected && !queued.length && !pending.size && revision.current >= acknowledgedRevision;
      setSaving(Boolean(queued.length || pending.size || revision.current < acknowledgedRevision)); latest.current.onSync(syncedRef.current);
      if (syncedRef.current) { try { sessionStorage.removeItem(draftKey); } catch { /* Optional. */ } exportRef.current?.(); }
    };
    const flush = () => {
      flushTimer = undefined;
      if (!queued.length || socket?.readyState !== WebSocket.OPEN || !allowed) return;
      const id = crypto.randomUUID(); pending.add(id);
      socket.send(JSON.stringify({ type: "update", format: "blocks", id, data: encode(Y.mergeUpdates(queued)) })); queued = [];
    };
    const updated = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      queued.push(update); draft(); syncedRef.current = false; setSaving(true); latest.current.onSync(false);
      if (!flushTimer) flushTimer = setTimeout(flush, 120);
    };
    doc.on("update", updated);
    const connect = async () => {
      if (disposed) return;
      if (retries) {
        const check = await fetch(`${props.apiBase}/api/collab/pages/${props.pageId}`, { credentials: "include" }).catch(() => null);
        if (disposed) return;
        if (check && [401, 403, 404].includes(check.status)) { setError("Session or access expired. Sign in again or contact the project manager."); return; }
      }
      socket = new WebSocket(`${(props.apiBase || window.location.origin).replace(/^http/, "ws")}/api/collab/pages/${props.pageId}/live`);
      socket.onopen = () => socket?.send(JSON.stringify({ type: "presence" }));
      socket.onmessage = event => {
        if (disposed) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "update") {
            Y.applyUpdate(doc, decode(message.data), "remote"); revision.current = Math.max(revision.current, message.seq || 0);
            if (readyConnected) { syncStatus(); exportRef.current?.(); }
          }
          if (message.type === "ready") {
            if (message.format !== "blocks") { setError("Document format changed. Reload this page."); socket?.close(4403); return; }
            revision.current = Math.max(revision.current, message.revision || 0);
            readyConnected = true; allowed = latest.current.canEdit && message.access >= 3;
            if (allowed) {
              try { const saved = sessionStorage.getItem(draftKey); if (saved) Y.applyUpdate(doc, decode(saved), "recovery"); } catch { setError("Could not restore the local draft."); }
              if (queued.length || pending.size || retries) { queued = [Y.encodeStateAsUpdate(doc)]; pending.clear(); flush(); }
            }
            setReady(true); setWritable(allowed); setError(""); retries = 0; syncStatus();
          }
          if (message.type === "permission") { allowed = latest.current.canEdit && message.access >= 3; setWritable(allowed); if (!allowed) setError("Editing access was revoked. You can still read and export."); }
          if (message.type === "ack") { pending.delete(message.id); acknowledgedRevision = Math.max(acknowledgedRevision, message.revision || 0); syncStatus(); }
          if (message.type === "presence") setPresence(message.people || []);
          if (message.type === "error") setError(message.message || "Update rejected");
        } catch { setError("Could not read the live update. Reload if the problem persists."); }
      };
      socket.onclose = event => {
        if (disposed) return;
        readyConnected = false; allowed = false; syncedRef.current = false; setWritable(false); latest.current.onSync(false);
        if ([4401, 4403].includes(event.code)) { setError("Session or access expired. Your unacknowledged draft remains on this device."); return; }
        setError(latest.current.language === "vi" ? "Mất kết nối. Tạm khóa sửa, đang kết nối lại…" : "Disconnected. Editing paused; reconnecting…");
        timer = setTimeout(() => void connect(), Math.min(1500 * 2 ** retries++, 15000));
      };
    };
    void connect();
    const heartbeat = setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "presence" })); }, 10000);
    const leave = (event: BeforeUnloadEvent) => { if (pending.size || queued.length) { draft(); event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leave);
    return () => {
      disposed = true; clearInterval(heartbeat); clearTimeout(timer); clearTimeout(flushTimer);
      if (pending.size || queued.length) draft(); flush(); socket?.close(); doc.off("update", updated);
      window.removeEventListener("beforeunload", leave);
    };
  }, [doc, props.apiBase, props.pageId, props.userId]);
  return <div className="collab-editor notebook-block-editor">
    <div className="collab-editor__status" role="status">
      <span className={ready && !error ? "is-live" : ""}>{ready && !error ? <Wifi size={15} /> : <WifiOff size={15} />}{error ? (props.language === "vi" ? "Chưa đồng bộ" : "Not synced") : saving ? (props.language === "vi" ? "Đang lưu…" : "Saving…") : ready ? (props.language === "vi" ? "Đã đồng bộ" : "All changes synced") : "Connecting…"}</span>
      <span>{presence.length} {props.language === "vi" ? "người đang xem" : "viewing"}</span>
      {presence.map(person => <span className="collab-editor__presence" key={person.id} title={person.public_name || person.display_name}>{person.display_name.slice(0, 1)}</span>)}
    </div>
    {error && <p className="collab-inline-error" role="alert">{error}</p>}
    {ready ? <RichCanvas {...props} doc={doc} writable={writable} revision={revision} synced={syncedRef} exportRef={exportRef} /> : <p className="collab-muted">{props.language === "vi" ? "Đang đồng bộ các khối…" : "Syncing blocks…"}</p>}
  </div>;
}

function RichCanvas({ doc, writable, revision, synced, exportRef, ...props }: Props & {
  doc: Y.Doc; writable: boolean; revision: MutableRefObject<number>; synced: MutableRefObject<boolean>; exportRef: MutableRefObject<(() => void) | null>;
}) {
  const [theme, setTheme] = useState<"light" | "dark">(() => document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const latest = useRef(props); latest.current = props;
  const appliedOperation = useRef(0);
  const indexTimer = useRef<ReturnType<typeof setTimeout>>();
  const exportCounter = useRef(0);
  const editor = useCreateBlockNote(withCollaboration({ schema, domAttributes: { editor: { "aria-label": "Research notebook content" } }, collaboration: { fragment: doc.getXmlFragment("notebook"), user: { name: props.username || "Researcher", color: "#476cf1" } } }), [doc]);
  const [conversionError, setConversionError] = useState('');
  const convertingBlocks = useRef(new Set<string>());
  const convertToPage = async (blockId: string) => {
    const source = editor.getBlock(blockId), create = latest.current.onConvertToPage;
    if (!create || !source || !editor.isEditable || convertingBlocks.current.has(blockId)) return;
    convertingBlocks.current.add(blockId); setConversionError('');
    const original = JSON.stringify(source);
    const title = equationSource(source.content as never).trim().slice(0, 120) || (latest.current.language === 'vi' ? 'Trang không tiêu đề' : 'Untitled page');
    const seed = blocksToYDoc(editor, [freshBlockCopy(source)], 'notebook');
    try {
      const page = await create({ title, update: encode(Y.encodeStateAsUpdate(seed)) });
      // Preserve concurrent typing. Only replace the source after the child is saved.
      const current = editor.getBlock(blockId);
      if (editor.isEditable && current && JSON.stringify(current) === original) editor.updateBlock(current, { type: 'pageLink', props: { pageId: page.id, title: page.title }, children: [] });
      else setConversionError(latest.current.language === 'vi' ? 'Đã tạo trang con trong cây. Khối gốc có thay đổi mới nên được giữ nguyên.' : 'Subpage created in the tree. The original block had newer changes and was preserved.');
    } catch (reason) { setConversionError(`${latest.current.language === 'vi' ? 'Chưa chuyển được khối; nội dung gốc vẫn giữ nguyên.' : 'Conversion failed; the original content is preserved.'} ${String(reason)}`); }
    finally { seed.destroy(); convertingBlocks.current.delete(blockId); }
  };
  const conversionRef = useRef(convertToPage); conversionRef.current = convertToPage;
  const BlockSideMenu = useMemo(() => {
    // Keep the menu component identity stable while the hover target changes.
    // A new component would unmount open submenus on SideMenu updates.
    const BlockActions = () => <NotebookBlockMenu language={props.language} apiBase={props.apiBase} pageId={props.pageId} onConvertToPage={props.onConvertToPage ? id => void conversionRef.current(id) : undefined} />;
    return () => <SideMenu dragHandleMenu={BlockActions} />;
  }, [props.language, props.apiBase, props.pageId, !!props.onConvertToPage]);
  const BlockFormattingToolbar = useMemo(() => () => <FormattingToolbar blockTypeSelectItems={[...blockTypeSelectItems(editor.dictionary), ...getMathBlockTypeSelectItems(editor)]} />, [editor]);
  useEffect(() => { editor.isEditable = writable; }, [editor, writable]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('block');
    if (!id || !editor.getBlock(id)) return;
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
      target?.scrollIntoView({ block: 'center', behavior: 'auto' });
      target?.classList.add('notebook-block-linked');
    });
    const timer = setTimeout(() => document.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.remove('notebook-block-linked'), 2200);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [editor]);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] }); return () => observer.disconnect();
  }, []);
  const publish = async () => {
    const generation = ++exportCounter.current;
    const blocks = editor.document;
    const projection = mathMarkdownProjection(blocks, crypto.randomUUID());
    const markdown = projection.restore(await editor.blocksToMarkdownLossy(projection.blocks));
    if (generation !== exportCounter.current) return;
    latest.current.onReady(markdown); latest.current.onBlocks?.(blocks);
    clearTimeout(indexTimer.current);
    if (writable && synced.current) {
      const atRevision = revision.current;
      indexTimer.current = setTimeout(() => {
        void documentRequest(props.apiBase, `/pages/${props.pageId}/projection`, { method: "PUT", body: JSON.stringify({ revision: atRevision, markdown, blocks }) }).catch(() => { /* A newer edit wins; next ack refreshes the cache. */ });
      }, 350);
    }
  };
  useEffect(() => { exportRef.current = () => void publish(); void publish(); return () => { exportRef.current = null; exportCounter.current++; clearTimeout(indexTimer.current); }; }, [editor, writable]);
  useEffect(() => {
    const operation = props.operation;
    if (!writable || !operation || operation.id === appliedOperation.current) return;
    let cancelled = false;
    void Promise.resolve().then(() => operation.blocks ? BlockNoteEditor.create({ schema, initialContent: operation.blocks }).document : parseNotebookMarkdown(editor, operation.content)).then(blocks => {
      if (cancelled || !editor.isEditable || !blocks.length) return;
      appliedOperation.current = operation.id;
      if (operation.mode === "replace") editor.replaceBlocks(editor.document, blocks);
      else editor.insertBlocks(blocks, editor.document[editor.document.length - 1], "after");
    }).catch(() => { window.alert(latest.current.language === "vi" ? "Không đọc được nội dung nhập. Trang hiện tại vẫn được giữ." : "Could not read the imported content. The current page is preserved."); });
    return () => { cancelled = true; };
  }, [editor, props.operation, writable]);
  return <>
    {conversionError && <p role="alert" className="collab-inline-error">{conversionError}</p>}
    <PageLinks.Provider value={{ onOpen: props.onOpenPage, onCreateUnder: props.canEdit ? props.onCreateSubpageUnder : undefined, language: props.language, pages: props.pages }}>
    <BlockNoteView editor={editor} editable={writable} theme={theme} slashMenu={false} sideMenu={false} formattingToolbar={false} onChange={() => void publish()}>
      <SideMenuController sideMenu={BlockSideMenu} />
      <FormattingToolbarController formattingToolbar={BlockFormattingToolbar} />
      <SuggestionMenuController triggerCharacter="/" getItems={async query => filterSuggestionItems([
        ...(props.onCreateSubpage ? [{ title: props.language === 'vi' ? 'Trang con' : 'Subpage', subtext: props.language === 'vi' ? 'Tạo tài liệu bên trong trang này' : 'Create a page inside this page', aliases: ['page', 'subpage', 'trang', 'notebook'], group: 'Notebook', icon: <FilePlus2 size={18} />, onItemClick: props.onCreateSubpage }] : []),
        ...getDefaultReactSlashMenuItems(editor), ...getMathSlashMenuItems(editor).map((item, index) => ({ ...item, title: index === 0 ? 'Block equation' : (props.language === 'vi' ? 'Công thức trong dòng' : 'Inline equation'), aliases: [...(item.aliases || []), 'math', 'equation', 'latex', 'cong thuc'] }))], query)} />
    </BlockNoteView>
    </PageLinks.Provider>
  </>;
}
