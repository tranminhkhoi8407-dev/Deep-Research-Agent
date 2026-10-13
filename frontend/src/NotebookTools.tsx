import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, FilePlus2, FileText, GripVertical, Link2, Plus, Search } from "lucide-react";
import type { Language } from "./ProductViews";
import type { DomainResearchPayload, ResearchDomainId } from "./DomainHub";

export type NotebookPage = { id: string; title: string; parent_id: string | null; position?: number; icon?: string; favorite?: boolean; updated_at?: string };
export type NotebookEvidence = { id: string; title: string; url: string; doi: string; note: string };
export type NotebookReferences = { pages: NotebookPage[]; evidence: NotebookEvidence[]; backlinks: { id: string; title: string }[] };
type ConfirmationOptions = { title?: string; confirmLabel?: string; destructive?: boolean };

// A themed native dialog handles modality and return focus; Tab wraps inside it.
// The action happens only after confirmation; unmounting cancels it safely.
export function useNotebookConfirm(language: Language) {
  const [prompt, setPrompt] = useState<{ message: string; options: ConfirmationOptions } | null>(null);
  const titleId = useId(), messageId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pending = useRef<((accepted: boolean) => void) | null>(null);
  const ask = useCallback((message: string, options: ConfirmationOptions = {}) => new Promise<boolean>(resolve => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pending.current?.(false); pending.current = resolve; setPrompt({ message, options });
  }), []);
  const finish = (accepted: boolean) => {
    const resolve = pending.current; pending.current = null;
    const returnFocus = opener.current; opener.current = null;
    dialog.current?.close(); setPrompt(null); resolve?.(accepted);
    // Callers can keep the trigger disabled while awaiting confirmation. Restore
    // after React has processed cancellation, without stealing a new dialog's focus.
    requestAnimationFrame(() => {
      if (returnFocus?.isConnected && !document.querySelector('dialog[open]')) returnFocus.focus();
    });
  };
  useEffect(() => { if (prompt && !dialog.current?.open) dialog.current?.showModal(); }, [prompt]);
  useEffect(() => () => { pending.current?.(false); pending.current = null; }, []);
  const confirmation = <dialog ref={dialog} className="notebook-confirm" aria-labelledby={titleId} aria-describedby={messageId} onCancel={event => { event.preventDefault(); finish(false); }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <h3 id={titleId}>{prompt?.options.title || (language === "vi" ? "Xác nhận thao tác" : "Confirm notebook action")}</h3>
    <p id={messageId}>{prompt?.message}</p>
    <div><button type="button" autoFocus onClick={() => finish(false)}>{language === "vi" ? "Hủy" : "Cancel"}</button><button type="button" className={prompt?.options.destructive ? 'is-danger' : undefined} onClick={() => finish(true)}>{prompt?.options.confirmLabel || (language === "vi" ? "Xác nhận" : "Confirm")}</button></div>
  </dialog>;
  return [ask, confirmation] as const;
}
export function markdownLabel(text: string) { return text.replace(/[\\[\]]/g, "\\$&").replace(/[\r\n]+/g, " "); }
function sourceDomain(value: string) { try { return new URL(value).hostname; } catch { return "Source"; } }
async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}/api/collab${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(typeof result.detail === "string" ? result.detail : "Could not load notebook"); }
  return response.json();
}

export function NotebookSearch({ apiBase, language, field, projectId, onOpen }: {
  apiBase: string; language: Language; field?: string | null; projectId?: string; onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; title: string; project_name: string; snippet: string }[]>([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const id = ++generation.current; setResults([]); setError("");
    if (query.trim().length < 2) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ query: query.trim() }); if (field) params.set("field", field); if (projectId) params.set("project_id", projectId);
      void request<{ pages: typeof results }>(apiBase, `/search-pages?${params}`).then(data => { if (id === generation.current) setResults(data.pages); }).catch(reason => { if (id === generation.current) setError(String(reason)); }).finally(() => { if (id === generation.current) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); generation.current++; };
  }, [apiBase, query, field, projectId]);
  const vi = language === "vi";
  return <div className="notebook-search">
    <label><Search size={16} /><input aria-label={vi ? "Tìm trong notebook" : "Search notebook"} placeholder={vi ? "Tìm tên hoặc nội dung trang…" : "Search page titles and content…"} value={query} onChange={event => setQuery(event.target.value)} maxLength={200} /></label>
    {query.trim().length >= 2 && <div className="notebook-search__results" role="status">
      {loading ? (vi ? "Đang tìm…" : "Searching…") : error || (!results.length ? (vi ? "Không có trang phù hợp mà bạn có quyền xem." : "No matching pages you can access.") : results.map(item => <button type="button" key={item.id} onClick={() => onOpen(item.id)}><strong>{item.title}</strong><small>{item.project_name}</small><span>{item.snippet}</span></button>))}
      <small>{vi ? "Nội dung mới có thể mất vài giây để xuất hiện trong kết quả." : "New edits may take a few seconds to appear in search."}</small>
    </div>}
  </div>;
}

export function NotebookTree({ apiBase, language, projectId, pageId, pages, canEdit, onOpen, onChanged }: {
  apiBase: string; language: Language; projectId: string; pageId: string; pages: NotebookPage[]; canEdit: boolean; onOpen: (id: string) => void; onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(""), [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dragId = useRef<string | null>(null);
  const vi = language === "vi";
  const ordered: { page: NotebookPage; depth: number }[] = [], visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const page of pages.filter(item => item.parent_id === parentId)) {
      if (visited.has(page.id)) continue;
      visited.add(page.id); ordered.push({ page, depth }); walk(page.id, depth + 1);
    }
  };
  walk(null, 0); for (const page of pages) if (!visited.has(page.id)) { ordered.push({ page, depth: 0 }); walk(page.id, 1); }
  const reorder = async (moving: NotebookPage, target: NotebookPage) => {
    if (busy || moving.id === target.id || moving.parent_id !== target.parent_id) return;
    const ids = pages.filter(item => item.parent_id === moving.parent_id).map(item => item.id);
    const from = ids.indexOf(moving.id), to = ids.indexOf(target.id); ids.splice(from, 1); ids.splice(to, 0, moving.id);
    setBusy(true); setError("");
    try { await request(apiBase, `/projects/${projectId}/page-order`, { method: "PUT", body: JSON.stringify({ parent_id: moving.parent_id, page_ids: ids }) }); await onChanged(); }
    catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  return <nav className="collab-card notebook-tree" aria-label={vi ? "Cây trang notebook" : "Notebook page tree"}>
    <h3>{vi ? "Trang nghiên cứu" : "Research pages"}</h3>
    <NotebookSearch apiBase={apiBase} language={language} projectId={projectId} onOpen={onOpen} />
    <div className="notebook-tree__items">
      {ordered.map(({ page, depth }) => {
        const siblings = pages.filter(item => item.parent_id === page.parent_id), index = siblings.findIndex(item => item.id === page.id);
        return <div key={page.id} className={page.id === pageId ? "is-current" : ""} style={{ paddingLeft: Math.min(depth, 6) * 12 }} onDragOver={event => { if (canEdit) event.preventDefault(); }} onDrop={event => { event.preventDefault(); const source = pages.find(item => item.id === dragId.current); if (source) void reorder(source, page); dragId.current = null; }}>
          {canEdit && <span draggable={!busy} className="notebook-tree__drag" aria-hidden="true" onDragStart={event => { dragId.current = page.id; event.dataTransfer.setData("text/plain", page.id); }} onDragEnd={() => { dragId.current = null; }}><GripVertical size={13} /></span>}
          <button type="button" aria-current={page.id === pageId ? "page" : undefined} onClick={() => onOpen(page.id)}><FileText size={15} /><span>{page.title}</span></button>
          {canEdit && <span className="notebook-tree__arrows"><button type="button" disabled={busy || index === 0} aria-label={`${vi ? "Đưa lên" : "Move up"} ${page.title}`} onClick={() => void reorder(page, siblings[index - 1])}><ArrowUp size={12} /></button><button type="button" disabled={busy || index === siblings.length - 1} aria-label={`${vi ? "Đưa xuống" : "Move down"} ${page.title}`} onClick={() => void reorder(page, siblings[index + 1])}><ArrowDown size={12} /></button></span>}
        </div>;
      })}
    </div>
    {canEdit && <form className="collab-form" onSubmit={event => {
      event.preventDefault(); setBusy(true); setError("");
      void request<{ page: NotebookPage }>(apiBase, `/projects/${projectId}/pages`, { method: "POST", body: JSON.stringify({ title: name.trim(), parent_id: parent || null }) }).then(async result => { setName(""); await onChanged(); onOpen(result.page.id); }).catch(reason => setError(String(reason))).finally(() => setBusy(false));
    }}>
      <input aria-label={vi ? "Tên trang mới" : "New page title"} placeholder={vi ? "Trang mới…" : "New page…"} value={name} onChange={event => setName(event.target.value)} maxLength={120} />
      <select aria-label={vi ? "Trang cha" : "Parent page"} value={parent} onChange={event => setParent(event.target.value)}><option value="">{vi ? "Trang gốc" : "Top level"}</option>{pages.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
      <button type="submit" disabled={busy || !name.trim()}><FilePlus2 size={15} />{vi ? "Tạo trang" : "Create page"}</button>
    </form>}
    {error && <p className="collab-inline-error" role="alert">{error}</p>}
    <small>{vi ? "Kéo giữa các trang cùng cấp; nút ↑↓ dùng được bằng bàn phím. Đổi trang cha ở phần tổ chức dự án." : "Drag between sibling pages, or use ↑↓ with your keyboard. Change a parent in project organization."}</small>
  </nav>;
}

export function NotebookSources({ language, references, canEdit, onInsert, onOpen, body }: {
  language: Language; references: NotebookReferences; canEdit: boolean; onInsert: (content: string) => void; onOpen: (id: string) => void; body: string;
}) {
  const vi = language === "vi";
  return <div className="collab-side-content notebook-sources">
    <h3>{vi ? "Nguồn của dự án" : "Project evidence"}</h3>
    <p className="collab-muted">{vi ? "Chỉ metadata được chèn; ghi chú đọc cá nhân không tự chia sẻ." : "Insert metadata only; private reading notes are not shared automatically."}</p>
    {!references.evidence.length && <p>{vi ? "Thêm paper từ Library ở mục Evidence của dự án." : "Add saved Library papers from the project's Evidence tab."}</p>}
    {references.evidence.map(item => <article key={item.id}><strong>{item.title}</strong><a href={item.url} target="_blank" rel="noopener noreferrer"><Link2 size={13} />{item.doi || sourceDomain(item.url)}</a>{body.includes(item.url) && <small>{vi ? "Đã được trích dẫn trong trang" : "Cited on this page"}</small>}{canEdit && <button type="button" onClick={() => onInsert(`[${markdownLabel(item.title)}](${item.url})${item.doi ? ` · DOI: ${item.doi}` : ""}`)}>{vi ? "Chèn trích dẫn" : "Insert citation"}</button>}</article>)}
    <h3>{vi ? "Liên kết trang" : "Page links"}</h3>
    {canEdit && <div className="notebook-page-links">{references.pages.map(page => <button type="button" className="notebook-link-item" key={page.id} aria-label={(vi ? 'Chèn liên kết đến ' : 'Insert page link: ') + page.title} title={page.title} onClick={() => onInsert(`[${markdownLabel(page.title)}](#/collab/page/${page.id})`)}><span className="notebook-link-item__icon" aria-hidden="true"><FileText size={16} /></span><span className="notebook-link-item__title">{page.title}</span><span className="notebook-link-item__action" aria-hidden="true"><Plus size={15} /></span></button>)}</div>}
    <h3>{vi ? "Trang dẫn đến đây" : "Backlinks"}</h3>
    {references.backlinks.length ? <div className="notebook-page-links">{references.backlinks.map(page => <button type="button" className="notebook-link-item" key={page.id} aria-label={(vi ? 'Mở trang liên kết: ' : 'Open linked page: ') + page.title} title={page.title} onClick={() => onOpen(page.id)}><span className="notebook-link-item__icon" aria-hidden="true"><Link2 size={16} /></span><span className="notebook-link-item__title">{page.title}</span><span className="notebook-link-item__action" aria-hidden="true"><ArrowRight size={15} /></span></button>)}</div> : <p className="collab-muted">{vi ? "Chưa có trang bạn được quyền xem liên kết tới đây." : "No accessible pages link here yet."}</p>}
  </div>;
}

export function NotebookBrief({ language, title, body, field, references, onPrepare }: {
  language: Language; title: string; body: string; field: ResearchDomainId; references: NotebookReferences; onPrepare: (payload: DomainResearchPayload) => void;
}) {
  const sections = body.split(/(?=^#{1,3} )/m).filter(value => value.trim());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sourceIds, setSourceIds] = useState<Set<string>>(new Set());
  const [topic, setTopic] = useState(title);
  const vi = language === "vi";
  const toggle = <T,>(set: Set<T>, value: T) => { const next = new Set(set); if (next.has(value)) next.delete(value); else next.add(value); return next; };
  const notes = sections.filter((_, index) => selected.has(index)).join("\n\n");
  const sources = references.evidence.filter(item => sourceIds.has(item.id));
  const content = [notes, sources.length ? `## ${vi ? "Nguồn tham khảo đã chọn" : "Selected references"}\n${sources.map(item => `- ${item.title}: ${item.url}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
  return <details className="collab-import notebook-brief">
    <summary>{vi ? "Dùng trang này làm research brief" : "Use this page as a research brief"}</summary>
    <p>{vi ? "Chỉ các mục được chọn mới được chuyển. Bạn vẫn phải bấm Bắt đầu nghiên cứu; chưa có yêu cầu AI nào được gửi." : "Only selected sections are copied. You must still press Start research; no AI request is sent yet."}</p>
    <label>{vi ? "Câu hỏi nghiên cứu" : "Research question"}<input value={topic} onChange={event => setTopic(event.target.value)} maxLength={1000} /></label>
    <fieldset><legend>{vi ? "Nội dung được phép đưa vào brief" : "Sections to include"}</legend>{sections.map((section, index) => <label className="notebook-check" key={index}><input type="checkbox" checked={selected.has(index)} onChange={() => setSelected(toggle(selected, index))} /><span>{section.trim().split("\n")[0].replace(/^#+ /, "").slice(0, 120)}</span></label>)}</fieldset>
    <fieldset><legend>{vi ? "Metadata nguồn" : "Source metadata"}</legend>{references.evidence.map(source => <label className="notebook-check" key={source.id}><input type="checkbox" checked={sourceIds.has(source.id)} onChange={() => setSourceIds(toggle(sourceIds, source.id))} /><span>{source.title}</span></label>)}</fieldset>
    <details><summary>{vi ? "Xem chính xác nội dung sẽ chuyển" : "Preview exactly what will be copied"}</summary><pre>{content || (vi ? "Chưa chọn nội dung." : "Nothing selected.")}</pre></details>
    <p className="collab-muted">{vi ? "Link nguồn là ngữ cảnh, không bảo đảm AI đọc được toàn văn. Nếu chạy nghiên cứu, nội dung bạn chọn được gửi tới dịch vụ AI của hệ thống." : "Source links are context, not guaranteed full-text retrieval. Starting research sends your chosen content to the configured AI service."}</p>
    <button type="button" disabled={topic.trim().length < 8 || content.length > 10000} onClick={() => onPrepare({ topic: topic.trim(), domain: field, domainLabel: field, category: "notebook", categoryLabel: title, researchNotes: content, latexContext: "", sourcePreferences: [] })}>{vi ? "Chuẩn bị brief — chưa chạy" : "Prepare brief — do not run"}</button>
    {content.length > 10000 && <p role="alert">{vi ? "Chọn ít nội dung hơn: tối đa 10.000 ký tự." : "Select less content: maximum 10,000 characters."}</p>}
  </details>;
}
