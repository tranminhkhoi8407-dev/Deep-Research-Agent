import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, FilePlus2, Search, X, Plus } from 'lucide-react';
import type { Language } from './ProductViews';
import type { ResearchDomainId } from './DomainHub';
import { domains } from './DomainHub';
import { NotebookPageIcon } from './NotebookPageIcon';
import { relativeTime, tabLimit, type TabState } from './workspaceTabs';
export type TabPage = { id: string; title: string; field: ResearchDomainId; icon: string; parent_id: string | null; updated_at: string; snippet: string; opened_at: string | null };
export type TabControls = {
  state: TabState; onSelect: (id: string) => void; onClose: (id: string) => void;
  onStep: (direction: number) => void; onOpen: (page: TabPage) => void;
  onResolved: (hash: string, title: string, icon: string) => void;
};
export function NotebookTabs({ controls, language, onAdd, disabledAdd = false }: { controls: TabControls; language: Language; onAdd: () => void; disabledAdd?: boolean }) {
  const vi = language === 'vi', active = controls.state.tabs.find(tab => tab.id === controls.state.active), listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [controls.state.active]);
  const moveFocus = (event: React.KeyboardEvent, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % controls.state.tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + controls.state.tabs.length) % controls.state.tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = controls.state.tabs.length - 1;
    else return;
    event.preventDefault(); controls.onSelect(controls.state.tabs[next].id);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return <div className="notebook-tabs">
    <div className="notebook-tab-history"><button aria-label={vi ? 'Trang trước trong tab' : 'Back in tab'} disabled={!active || !active.index} onClick={() => controls.onStep(-1)}><ArrowLeft size={16} /></button><button aria-label={vi ? 'Trang tiếp theo trong tab' : 'Forward in tab'} disabled={!active || active.index === active.history.length - 1} onClick={() => controls.onStep(1)}><ArrowRight size={16} /></button></div>
    <div ref={listRef} className="notebook-tab-list" role="tablist" aria-label={vi ? 'Các tab trong workspace' : 'Workspace tabs'}>{controls.state.tabs.map((tab, index) => {
      const entry = tab.history[tab.index], selected = tab.id === controls.state.active;
      return <div className={`notebook-tab ${selected ? 'is-active' : ''}`} key={tab.id}><button role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} onKeyDown={event => moveFocus(event, index)} onClick={() => controls.onSelect(tab.id)} title={entry.title}><NotebookPageIcon icon={entry.icon} size={15} /><span>{entry.title}</span></button><button aria-label={`${vi ? 'Đóng tab' : 'Close tab'} ${entry.title}`} onClick={() => controls.onClose(tab.id)}><X size={13} /></button></div>;
    })}</div>
    <button className="notebook-tab-add" aria-label={vi ? 'Mở trang trong tab mới' : 'Open page in new workspace tab'} disabled={disabledAdd || controls.state.tabs.length >= tabLimit} title={vi ? 'Tìm trang hoặc tạo trang mới' : 'Find a page or create a new page'} onClick={onAdd}><Plus size={19} /></button>
  </div>;
}
export function NotebookTabPicker({ apiBase, language, field, onOpen, onNewPage, onClose }: { apiBase: string; language: Language; field: ResearchDomainId; onOpen: (page: TabPage) => void; onNewPage: () => void; onClose: () => void }) {
  const vi = language === 'vi', dialog = useRef<HTMLDialogElement>(null), resultsRef = useRef<HTMLDivElement>(null), requestId = useRef(0);
  const [query, setQuery] = useState(''), [scope, setScope] = useState(''), [pages, setPages] = useState<TabPage[]>([]), [selected, setSelected] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { dialog.current?.close(); previous?.focus(); }; }, []);
  useEffect(() => {
    const generation = ++requestId.current, abort = new AbortController(); setLoading(true); setError('');
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ query }); if (scope) params.set('field', scope);
      void fetch(`${apiBase}/api/collab/tab-pages?${params}`, { credentials: 'include', signal: abort.signal }).then(async response => {
        const result = await response.json(); if (!response.ok) throw new Error(result.detail || 'Unable to load pages');
        if (generation === requestId.current) { setPages(result.pages); setSelected(0); }
      }).catch(reason => { if (!abort.signal.aborted) setError(String(reason.message)); }).finally(() => { if (!abort.signal.aborted && generation === requestId.current) setLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [apiBase, query, scope]);
  const preview = pages[selected];
  useEffect(() => { resultsRef.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' }); }, [selected, loading]);
  return <dialog ref={dialog} className="notebook-tab-picker" aria-label={vi ? 'Mở trong tab mới' : 'Open in new workspace tab'} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header><Search size={21} /><input autoFocus maxLength={200} placeholder={vi ? 'Tìm trang để mở trong tab mới…' : 'Open in new tab…'} aria-label={vi ? 'Tìm tên trang' : 'Search page titles'} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected(previous => Math.max(0, Math.min(pages.length - 1, previous + (event.key === 'ArrowDown' ? 1 : -1)))); } if (event.key === 'Enter' && preview && !loading) { event.preventDefault(); onOpen(preview); } }} /><button aria-label={vi ? 'Đóng' : 'Close'} onClick={onClose}><X size={19} /></button></header>
    <div className="notebook-picker-filters"><span>Aa {vi ? 'Chỉ tên trang' : 'Title only'}</span><label>{vi ? 'Trong' : 'In'} <select aria-label={vi ? 'Lọc lĩnh vực' : 'Filter field'} value={scope} onChange={event => setScope(event.target.value)}><option value="">{vi ? 'Tất cả lĩnh vực' : 'All fields'}</option>{domains.map(domain => <option key={domain.id} value={domain.id}>{domain[language].title}</option>)}</select></label></div>
    <div className="notebook-picker-grid"><div ref={resultsRef} className="notebook-picker-results"><button className="notebook-picker-create" onClick={onNewPage}><FilePlus2 size={19} /><strong>{vi ? 'Trang mới' : 'New page'}</strong><span>{domains.find(domain => domain.id === field)![language].title}</span></button><h3>{query ? vi ? 'Kết quả' : 'Results' : vi ? 'Gần đây trong các notebook của bạn' : 'Recent pages in your notebooks'}</h3>{loading ? <p role="status">{vi ? 'Đang tìm…' : 'Searching…'}</p> : error ? <p role="alert">{error}</p> : !pages.length ? <p>{vi ? 'Không tìm thấy trang. Bạn có thể tạo trang mới.' : 'No pages found. You can create a new page.'}</p> : pages.map((page, index) => <button className={selected === index ? 'is-selected' : ''} key={page.id} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onClick={() => onOpen(page)}><NotebookPageIcon icon={page.icon} size={19} /><span>{page.title}<small> — {domains.find(domain => domain.id === page.field)?.[language].title}</small></span></button>)}</div>
    <aside className="notebook-picker-preview" aria-label={vi ? 'Xem trước trang' : 'Page preview'}>{!loading && preview ? <><NotebookPageIcon icon={preview.icon} size={32} /><h2>{preview.title}</h2><small>{vi ? 'Đã sửa' : 'Edited'} {relativeTime(preview.updated_at, vi)}</small><p>{preview.snippet || (vi ? 'Mở trang để xem và tiếp tục viết.' : 'Open this page to read and continue writing.')}</p><button onClick={() => onOpen(preview)}>{vi ? 'Mở trong tab mới' : 'Open in new workspace tab'}<ArrowRight size={15} /></button></> : <p>{vi ? 'Chọn một trang để xem trước' : 'Select a page to preview'}</p>}</aside></div>
    <footer><span>↑ ↓ {vi ? 'Chọn trang' : 'Select page'} · Enter {vi ? 'Mở tab' : 'Open tab'} · Esc {vi ? 'Đóng' : 'Close'}</span><small>{vi ? 'Tab bên trong workspace, không phải tab trình duyệt' : 'Workspace tabs, not browser tabs'}</small></footer>
  </dialog>;
}
