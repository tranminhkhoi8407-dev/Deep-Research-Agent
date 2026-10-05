import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpen, ChevronDown, ChevronRight, Copy, FilePlus2, FileText, HelpCircle, LockKeyhole, LogOut, Menu, MoreHorizontal, Palette, PanelLeftClose, Plus, RotateCcw, Star, Trash2, Users, X } from 'lucide-react';
import { domains, DomainHub, type DomainResearchPayload, type ResearchDomainId } from './DomainHub';
import { displayName, type Appearance, type AuthUser } from './Auth';
import type { Language, StoredReportSummary } from './ProductViews';
import { PageView } from './CollaborationHub';
import { NotebookSearch, useNotebookConfirm } from './NotebookTools';
import { fieldHash, fieldRoute, pageAncestors, pageDescendants } from './fieldNavigation';
import './FieldWorkspace.css';
import { EditorGuide } from './EditorGuide';

type Page = {
  id: string; title: string; parent_id: string | null; position: number; icon: string; cover: string;
  full_width: boolean; favorite: boolean; opened_at: string | null; updated_at: string; archived_at: string | null;
};
type Workspace = { project_id: string; home_page_id: string; pages: Page[]; archived_pages: Page[] };
type Related = { id: string; name: string; group_id: string | null; status: string };
type Props = {
  apiBase: string; user: AuthUser; language: Language; reports: StoredReportSummary[];
  onPrepareResearch: (payload: DomainResearchPayload) => void;
  appearance: Appearance; onAppearanceChange: (value: Appearance) => void;
  onLanguageChange: (value: Language) => void; onOpenTour: () => void; onLogout: () => void;
};
async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}/api/collab${path}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${response.status})`);
  return data;
}
function navigate(hash: string) { window.location.hash = hash; }

export function FieldsPage(props: Props) {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  const route = fieldRoute(hash), vi = props.language === 'vi';
  if (route) return <FieldNotebook key={`${props.user.id}:${route.field}`} {...props} field={route.field} pageId={route.pageId} />;
  if (hash === '#/fields/guide') return <EditorGuide language={props.language} />;
  if (hash === '#/fields/toolkit') return <div className="field-legacy"><button onClick={() => navigate('#/fields')}><ArrowLeft size={16} />{vi ? 'Không gian lĩnh vực' : 'Field workspaces'}</button><DomainHub language={props.language} onStartResearch={props.onPrepareResearch} onOpenNotebook={field => navigate(fieldHash(field))} /></div>;
  return <section className="field-gallery">
    <div className="field-gallery__intro"><span className="field-eyebrow">YOUR RESEARCH, YOUR SPACE</span><h1>{vi ? 'Một lĩnh vực. Vô vàn ý tưởng.' : 'A field of your own.'}</h1><p>{vi ? 'Không gian để suy nghĩ, kết nối và viết. Mở một lĩnh vực, tạo những trang đầu tiên và xây dựng thư viện tri thức của riêng bạn.' : 'A place to think, connect, and write. Open a field, start a page, and build your own body of knowledge.'}</p><span className="field-private"><LockKeyhole size={14} />{vi ? 'Riêng tư mặc định · Chia sẻ khi bạn sẵn sàng' : 'Private by default · Share when you’re ready'}</span></div>
    <div className="field-gallery__heading"><h2>{vi ? 'Không gian nghiên cứu' : 'Research workspaces'}</h2><span>05 / {vi ? 'LĨNH VỰC' : 'DISCIPLINES'}</span></div>
    <div className="field-gallery__grid" data-tour="field-picker">{domains.map((domain, index) => {
      const Icon = domain.icon, copy = domain[props.language];
      return <a className={`field-entry field-tone-${domain.id}`} key={domain.id} href={fieldHash(domain.id)} aria-label={`${copy.title} — ${vi ? 'mở không gian nghiên cứu' : 'open research workspace'}`}>
        <div className="field-entry__art" aria-hidden="true"><span>0{index + 1}</span><Icon size={72} strokeWidth={1.1} /><div className="field-entry__orbit" /></div>
        <div className="field-entry__body"><span className="field-eyebrow">{domain.shortCode} / NOTEBOOK</span><h3>{copy.title}</h3><p>{copy.subtitle}</p><div className="field-entry__tags">{domain.categories.slice(0, 2).map(category => <span key={category.id}>{category[props.language].title}</span>)}</div><footer><span>{vi ? 'Mở không gian' : 'Open workspace'}</span><ArrowRight size={17} /></footer></div>
      </a>;
    })}</div>
    <div className="field-gallery__foot"><a href="#/fields/guide"><BookOpen size={18} />{vi ? 'Hướng dẫn editor & thư viện công thức LaTeX' : 'Editor guide & LaTeX formula library'}<ArrowRight size={15} /></a></div>
  </section>;
}

function FieldNotebook({ field, pageId: routedPage, ...props }: Props & { field: ResearchDomainId; pageId: string | null }) {
  const { apiBase, language, user } = props, vi = language === 'vi';
  const domain = domains.find(item => item.id === field)!, Icon = domain.icon;
  const [data, setData] = useState<Workspace | null>(null), [related, setRelated] = useState<Related[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [synced, setSynced] = useState(false);
  const [sidebar, setSidebar] = useState(false), [trash, setTrash] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ kind: 'new' | 'move'; parent: string } | null>(null);
  const [name, setName] = useState(''), [parent, setParent] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null), shellRef = useRef<HTMLDivElement>(null);
  const [ask, confirmation] = useNotebookConfirm(language);
  const generation = useRef(0), mutation = useRef(false);
  const pageId = routedPage || data?.home_page_id || '';
  const page = data?.pages.find(item => item.id === pageId);
  const refresh = useCallback(async () => {
    const id = ++generation.current;
    const next = await request<Workspace>(apiBase, `/field-workspaces/${field}`, { method: 'PUT', body: JSON.stringify({ language }) });
    if (id === generation.current) setData(next);
  }, [apiBase, field, language]);
  useEffect(() => {
    void refresh().catch(reason => setError(String(reason)));
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !mutation.current) void refresh().catch(reason => setError(String(reason))); }, 12000);
    return () => { clearInterval(timer); generation.current++; };
  }, [refresh]);
  useEffect(() => {
    let cancelled = false;
    void request<{ projects: Related[] }>(apiBase, `/projects?field=${field}`).then(result => { if (!cancelled) setRelated(result.projects); }).catch(() => { /* The main workspace has its own retry UI. */ });
    return () => { cancelled = true; };
  }, [apiBase, field]);
  useEffect(() => {
    if (!pageId || !data?.pages.some(item => item.id === pageId)) return;
    setSynced(false); setSidebar(false); setTrash(false);
    setCollapsed(previous => { const next = new Set(previous); pageAncestors(data.pages, pageId).forEach(item => next.delete(item.id)); return next; });
    void request(apiBase, `/pages/${pageId}/preference`, { method: 'PUT', body: JSON.stringify({ opened: true }) }).catch(reason => setError(String(reason)));
    shellRef.current?.querySelector('.field-notebook__canvas')?.scrollTo({ top: 0 });
  }, [apiBase, pageId, data?.project_id, page?.id]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSidebarCollapsed(false); setSidebar(true); setTimeout(() => shellRef.current?.querySelector<HTMLInputElement>('.notebook-search input')?.focus(), 0); }
      if (event.key === 'Escape') setSidebar(false);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { if (dialog) { dialogRef.current?.showModal(); dialogRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>(dialog.kind === 'new' ? 'input' : 'select')?.focus(); } }, [dialog]);
  useEffect(() => {
    const revealTourTarget = (event: Event) => {
      const target = (event as CustomEvent<string>).detail;
      if (target === 'field-tree') { setSidebarCollapsed(false); setSidebar(window.innerWidth <= 780); }
      else if (target === 'field-writing') setSidebar(false);
      else if (target === 'field-guide') { setSidebarCollapsed(false); setSidebar(window.innerWidth <= 780); }
    };
    window.addEventListener('nexora:field-tour-target', revealTourTarget);
    return () => window.removeEventListener('nexora:field-tour-target', revealTourTarget);
  }, []);
  const open = (id: string) => {
    if (data?.pages.some(item => item.id === id)) navigate(fieldHash(field, id));
    else navigate(`#/collab/page/${id}`); // References may intentionally point to another project.
  };
  const run = async (work: () => Promise<void>) => {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError('');
    try { await work(); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { mutation.current = false; setBusy(false); }
  };
  const patch = (id: string, changes: object) => request(apiBase, `/pages/${id}`, { method: 'PATCH', body: JSON.stringify(changes) });
  const newPage = (parentId = pageId) => { setName(''); setParent(parentId); setDialog({ kind: 'new', parent: parentId }); };
  const closeDialog = () => { dialogRef.current?.close(); setDialog(null); };
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (!data || !dialog) return;
    void run(async () => {
      if (dialog.kind === 'new') {
        const result = await request<{ page: Page }>(apiBase, `/projects/${data.project_id}/pages`, { method: 'POST', body: JSON.stringify({ title: name.trim(), parent_id: parent || null }) });
        // Load the newly created page before navigating: no transient "not found".
        await refresh(); closeDialog(); navigate(fieldHash(field, result.page.id));
      } else { await patch(pageId, { parent_id: parent || null }); closeDialog(); }
    });
  };
  const archive = async () => {
    if (!page || !data || !await ask(vi ? `Lưu trữ “${page.title}” và tất cả trang con? Bạn có thể khôi phục cả nhánh từ mục Đã lưu trữ.` : `Archive “${page.title}” and all its subpages? You can restore the branch from Archived pages.`)) return;
    void run(async () => { await request(apiBase, `/pages/${page.id}/archive`, { method: 'POST' }); navigate(fieldHash(field, page.parent_id || data.home_page_id)); });
  };
  const reorder = (direction: number) => {
    if (!page || !data) return;
    const ids = data.pages.filter(item => item.parent_id === page.parent_id).map(item => item.id), index = ids.indexOf(page.id), target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(async () => { await request(apiBase, `/projects/${data.project_id}/page-order`, { method: 'PUT', body: JSON.stringify({ parent_id: page.parent_id, page_ids: ids }) }); });
  };
  const tree = (parentId: string | null, depth = 0, visited = new Set<string>()): React.ReactNode => data?.pages.filter(item => item.parent_id === parentId).map(item => {
    if (visited.has(item.id)) return null;
    const branch = new Set(visited).add(item.id), hasChildren = data.pages.some(child => child.parent_id === item.id), isHome = item.id === data.home_page_id;
    return <div key={item.id}>
      <div className={`field-tree-row ${item.id === pageId ? 'is-active' : ''}`} style={{ '--depth': Math.min(depth, 8) } as CSSProperties}
        draggable={!isHome && !busy} onDragStart={event => { event.dataTransfer.setData('application/x-nexora-page', item.id); event.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={event => { if (event.dataTransfer.types.includes('application/x-nexora-page')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
        onDrop={event => { event.preventDefault(); const source = event.dataTransfer.getData('application/x-nexora-page'); if (!source || source === data.home_page_id || !data.pages.some(p => p.id === source) || pageDescendants(data.pages, source).has(item.id)) return; void run(async () => { await patch(source, { parent_id: item.id }); setCollapsed(previous => { const next = new Set(previous); next.delete(item.id); return next; }); }); }}>
        <button className="field-tree-expand" disabled={!hasChildren} aria-expanded={hasChildren ? !collapsed.has(item.id) : undefined} aria-label={`${vi ? 'Mở / thu gọn' : 'Expand / collapse'} ${item.title}`} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}>{hasChildren ? collapsed.has(item.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} /> : <span />}</button>
        <a href={fieldHash(field, item.id)} aria-current={item.id === pageId ? 'page' : undefined}><span className="field-page-icon">{item.icon || <FileText size={16} />}</span><span>{item.title}</span></a>
        <button className="field-tree-add" disabled={busy} aria-label={`${vi ? 'Thêm trang con vào' : 'Add subpage to'} ${item.title}`} onClick={() => newPage(item.id)}><Plus size={14} /></button>
      </div>
      {!collapsed.has(item.id) && tree(item.id, depth + 1, branch)}
    </div>;
  });
  const missing = !!data && !page;
  return <div ref={shellRef} className={`field-notebook field-tone-${field} ${sidebar ? 'sidebar-open' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${page?.full_width ? 'is-wide' : ''}`}>
    {confirmation}
    {sidebar && <button className="field-sidebar-scrim" aria-label={vi ? 'Đóng danh sách trang' : 'Close sidebar'} onClick={() => setSidebar(false)} />}
    <aside className="field-notebook__sidebar" aria-label={vi ? 'Điều hướng không gian nghiên cứu' : 'Research workspace navigation'}>
      <div className="field-sidebar-home"><a href="#/fields"><ArrowLeft size={14} />Nexora</a><button onClick={() => { setSidebar(false); setSidebarCollapsed(true); }} aria-label={vi ? 'Thu gọn sidebar' : 'Collapse sidebar'}><PanelLeftClose size={16} /></button></div>
      <label className="field-switcher"><span><Icon size={23} /></span><div><small>{vi ? 'Không gian cá nhân' : 'Personal workspace'}</small><select aria-label={vi ? 'Đổi lĩnh vực' : 'Switch field'} value={field} onChange={event => navigate(fieldHash(event.target.value as ResearchDomainId))}>{domains.map(item => <option key={item.id} value={item.id}>{item[language].title}</option>)}</select></div></label>
      {data && <NotebookSearch apiBase={apiBase} language={language} projectId={data.project_id} onOpen={open} />}
      <button className="field-new-button" disabled={!data || busy} onClick={() => newPage(data?.home_page_id)}><Plus size={17} />{vi ? 'Trang mới' : 'New page'}<kbd>＋</kbd></button>
      <div className="field-sidebar-scroll">
        {data && <section className="field-shortcuts"><a href={`#/collab/project/${data.project_id}`}><Users size={14} />{vi ? 'Quản lý nguồn & thành viên' : 'Manage evidence & members'}<ArrowRight size={12} /></a></section>}
        {data?.pages.some(item => item.favorite) && <section className="field-shortcuts"><h3><Star size={12} />{vi ? 'Yêu thích' : 'Favorites'}</h3>{data.pages.filter(item => item.favorite).map(item => <a href={fieldHash(field, item.id)} key={item.id}><span>{item.icon || '▤'}</span>{item.title}</a>)}</section>}
        <section className="field-page-tree" data-tour="field-tree"><h3>{vi ? 'Trang trong lĩnh vực' : 'Pages in this field'}</h3>{tree(null)}{!data && <p role="status">{vi ? 'Đang mở notebook…' : 'Opening notebook…'}</p>}</section>
        {data && <section className="field-shortcuts"><h3>{vi ? 'Gần đây' : 'Recently opened'}</h3>{data.pages.filter(item => item.opened_at).sort((a, b) => b.opened_at!.localeCompare(a.opened_at!)).slice(0, 4).map(item => <a href={fieldHash(field, item.id)} key={item.id}><FileText size={14} />{item.title}</a>)}</section>}
        {related.some(item => item.id !== data?.project_id && item.status !== 'archived') && <section className="field-shortcuts"><h3>{vi ? 'Dự án & notebook khác' : 'Other projects & notebooks'}</h3>{related.filter(item => item.id !== data?.project_id && item.status !== 'archived').map(item => <a key={item.id} href={`#/collab/project/${item.id}`}>{item.group_id ? <Users size={14} /> : <BookOpen size={14} />}{item.name}<ArrowRight size={12} /></a>)}</section>}
      </div>
      <div className="field-sidebar-bottom"><a className="field-sidebar-link" href="#/library"><BookOpen size={16} />{vi ? 'Thư viện bài báo' : 'Paper library'}</a><a className="field-sidebar-link" href="#/fields/guide" data-tour="field-guide"><BookOpen size={16} />{vi ? 'Hướng dẫn editor & LaTeX' : 'Editor & LaTeX guide'}</a><button onClick={() => { setTrash(value => !value); setSidebar(false); }} aria-expanded={trash}><Trash2 size={16} />{vi ? 'Đã lưu trữ' : 'Archived pages'}<span>{data?.archived_pages.length || 0}</span></button><button onClick={() => { setSidebarCollapsed(false); setSidebar(true); props.onOpenTour(); }}><HelpCircle size={16} />{vi ? 'Hướng dẫn workspace' : 'Workspace tour'}</button>
        <details className="field-account"><summary><span className="field-account-avatar">{user.avatar_url ? <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" /> : displayName(user).slice(0, 1).toUpperCase()}</span><strong>{displayName(user)}</strong><ChevronDown size={14} /></summary><div>
          <a href="#/profile">{vi ? 'Hồ sơ cá nhân' : 'My profile'}<ArrowRight size={12} /></a>
          <label>{vi ? 'Giao diện' : 'Appearance'}<select value={props.appearance} onChange={event => props.onAppearanceChange(event.target.value as Appearance)}><option value="system">{vi ? 'Theo hệ thống' : 'System'}</option><option value="light">{vi ? 'Sáng' : 'Light'}</option><option value="dark">{vi ? 'Tối' : 'Dark'}</option></select></label>
          <label>{vi ? 'Ngôn ngữ' : 'Language'}<select value={language} onChange={event => props.onLanguageChange(event.target.value as Language)}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>
          <a href="#/fields/guide">{vi ? 'Hướng dẫn editor & LaTeX' : 'Editor & LaTeX guide'}<BookOpen size={12} /></a>
          <button onClick={props.onLogout}><LogOut size={14} />{vi ? 'Đăng xuất' : 'Sign out'}</button>
        </div></details>
      </div>
    </aside>
    <div className="field-notebook__canvas">
      <header className="field-topbar"><button className="field-mobile-menu" onClick={() => { setSidebarCollapsed(false); setSidebar(value => !value); }} aria-label={vi ? 'Danh sách trang' : 'Page navigation'} aria-expanded={sidebar}><Menu size={19} /></button>
        <nav className="field-breadcrumbs" aria-label="Breadcrumb"><a href={fieldHash(field)}><Icon size={16} /><span>{domain.shortCode}</span></a>{data && pageAncestors(data.pages, pageId).map(item => <span key={item.id}><ChevronRight size={13} /><a href={fieldHash(field, item.id)} aria-current={item.id === pageId ? 'page' : undefined}>{item.title}</a></span>)}</nav>
        {page && <div className="field-topbar-actions"><button className={page.favorite ? 'is-favorite' : ''} disabled={busy} aria-label={vi ? 'Đánh dấu yêu thích' : 'Favorite page'} aria-pressed={!!page.favorite} onClick={() => void run(async () => { await request(apiBase, `/pages/${pageId}/preference`, { method: 'PUT', body: JSON.stringify({ favorite: !page.favorite }) }); })}><Star size={18} fill={page.favorite ? 'currentColor' : 'none'} /></button><button disabled={busy} aria-label={vi ? 'Trang con' : 'Subpage'} onClick={() => newPage()}><Plus size={17} /><span>{vi ? 'Trang con' : 'Subpage'}</span></button>
          <details className="field-page-menu"><summary aria-label={vi ? 'Thao tác trang' : 'Page actions'}><MoreHorizontal size={20} /></summary><div>
            <button disabled={busy || !synced} onClick={() => void run(async () => { const result = await request<{ page: Page }>(apiBase, `/pages/${pageId}/duplicate`, { method: 'POST' }); await refresh(); navigate(fieldHash(field, result.page.id)); })}><Copy size={15} />{vi ? 'Nhân bản trang (không kèm trang con)' : 'Duplicate page (without subpages)'}</button>
            {page.id !== data?.home_page_id && <><button disabled={busy} onClick={() => { setParent(page.parent_id || ''); setDialog({ kind: 'move', parent: page.parent_id || '' }); }}><ArrowRight size={15} />{vi ? 'Chuyển vào trang…' : 'Move into page…'}</button><button disabled={busy} onClick={() => reorder(-1)}><ArrowUp size={15} />{vi ? 'Đưa lên trong cùng cấp' : 'Move up among siblings'}</button><button disabled={busy} onClick={() => reorder(1)}><ArrowDown size={15} />{vi ? 'Đưa xuống trong cùng cấp' : 'Move down among siblings'}</button><button disabled={busy} onClick={() => void archive()}><Trash2 size={15} />{vi ? 'Lưu trữ cả nhánh' : 'Archive branch'}</button></>}
            <label><input type="checkbox" checked={!!page.full_width} disabled={busy} onChange={event => void run(async () => { await patch(pageId, { full_width: event.target.checked }); })} />{vi ? 'Toàn chiều rộng' : 'Full width'}</label>
          </div></details>
        </div>}
      </header>
      {error && <div className="field-error" role="alert"><span>{error}</span><button onClick={() => void run(refresh)} disabled={busy}><RotateCcw size={15} />{vi ? 'Thử lại' : 'Retry'}</button></div>}
      {trash ? <section className="field-archive"><header><h2>{vi ? 'Trang đã lưu trữ' : 'Archived pages'}</h2><button onClick={() => setTrash(false)} aria-label={vi ? 'Đóng' : 'Close'}><X size={20} /></button></header><p>{vi ? 'Khôi phục trang cha để đưa cả nhánh trở lại. Trang lưu trữ trước đó sẽ không tự khôi phục.' : 'Restore a parent to bring back its branch. Pages archived earlier remain archived.'}</p>{data?.archived_pages.length ? data.archived_pages.filter(item => !data.archived_pages.some(parent => parent.id === item.parent_id)).map(item => <div key={item.id}><FileText size={18} /><strong>{item.title}</strong><button disabled={busy} onClick={() => void run(async () => { await request(apiBase, `/pages/${item.id}/restore`, { method: 'POST' }); })}><RotateCcw size={15} />{vi ? 'Khôi phục' : 'Restore'}</button></div>) : <p>{vi ? 'Chưa có trang đã lưu trữ.' : 'No archived pages.'}</p>}</section>
        : missing ? <section className="field-archive"><h2>{vi ? 'Trang không có trong không gian này' : 'Page unavailable in this workspace'}</h2><p>{vi ? 'Trang có thể đã được lưu trữ, hoặc thuộc dự án khác.' : 'It may be archived or belong to another project.'}</p><a href={fieldHash(field)}>{vi ? 'Về trang chủ lĩnh vực' : 'Back to field home'}</a><a href={`#/collab/page/${pageId}`}>{vi ? 'Kiểm tra quyền truy cập trang được chia sẻ' : 'Check access to the shared page'}</a></section>
        : page && <PageView key={page.id} apiBase={apiBase} pageId={page.id} language={language} user={user} reports={props.reports} onBack={() => navigate(fieldHash(field))} onOpen={open} onPrepareResearch={props.onPrepareResearch} workspace={{
          onCreateChild: () => newPage(), onCreateChildUnder: id => { if (data?.pages.some(item => item.id === id)) newPage(id); }, onChanged: () => void refresh().catch(reason => setError(String(reason))), onSync: setSynced,
          onConvertToPage: async payload => {
            const result = await request<{ page: Page }>(apiBase, `/projects/${data!.project_id}/pages`, { method: 'POST', body: JSON.stringify({ title: payload.title, parent_id: pageId }) });
            try { await request(apiBase, `/pages/${result.page.id}/initialize-blocks`, { method: 'POST', body: JSON.stringify({ update: payload.update, expected_revision: 0 }) }); }
            finally { await refresh(); }
            return result.page;
          },
          header: <div className={`field-page-cover cover-${page.cover}`}><div className="field-cover-decoration" aria-hidden="true"><Icon size={100} strokeWidth={0.7} /></div><span className="field-cover-icon">{page.icon || <FileText size={38} />}</span><details className="field-customize"><summary><Palette size={15} />{vi ? 'Tùy chỉnh trang' : 'Customize page'}</summary><div><strong>{vi ? 'Biểu tượng' : 'Page icon'}</strong><div className="field-icon-options">{['', '∑', '⚛', '⚗', '🧬', '✦', '📖', '🔬', '💡', '🎯', '📝', '📊'].map(icon => <button key={icon} aria-label={icon || (vi ? 'Không biểu tượng' : 'No icon')} aria-pressed={page.icon === icon} disabled={busy} onClick={() => void run(async () => { await patch(pageId, { icon }); })}>{icon || '×'}</button>)}</div><strong>{vi ? 'Ảnh bìa màu' : 'Cover palette'}</strong><div className="field-cover-options">{['none', 'indigo', 'ocean', 'amber', 'forest', 'aurora'].map(cover => <button className={`cover-${cover}`} key={cover} aria-label={cover} aria-pressed={page.cover === cover} disabled={busy} onClick={() => void run(async () => { await patch(pageId, { cover }); })}>{cover === 'none' ? '×' : ''}</button>)}</div></div></details></div>,
        }} />}
    </div>
    <dialog ref={dialogRef} className="field-dialog" onCancel={closeDialog} onClick={event => { if (event.target === event.currentTarget) closeDialog(); }}>
      <form onSubmit={submit}><header><FilePlus2 size={23} /><h2>{dialog?.kind === 'move' ? vi ? 'Di chuyển trang' : 'Move page' : vi ? 'Tạo trang mới' : 'Create a page'}</h2><button type="button" aria-label={vi ? 'Đóng' : 'Close'} onClick={closeDialog}><X size={19} /></button></header>
        {dialog?.kind === 'new' && <label>{vi ? 'Tên trang' : 'Page title'}<input autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={120} required placeholder={vi ? 'Ví dụ: Giả thuyết và phương pháp' : 'e.g. Hypothesis and methods'} /></label>}
        <label>{vi ? 'Tạo bên trong / Trang cha' : 'Inside / Parent page'}<select value={parent} onChange={event => setParent(event.target.value)}><option value="">{vi ? 'Cấp cao nhất' : 'Top level'}</option>{data?.pages.filter(item => dialog?.kind !== 'move' || !pageDescendants(data.pages, pageId).has(item.id)).map(item => <option key={item.id} value={item.id}>{pageAncestors(data.pages, item.id).map(p => p.title).join(' / ')}</option>)}</select></label>
        <p><LockKeyhole size={15} />{vi ? 'Trang mới không tự nhận quyền chia sẻ riêng của trang cha. Thành viên dự án vẫn có quyền của dự án.' : 'New pages do not inherit direct page invitations. Project members retain their project access.'}</p>
        {error && <p role="alert" className="field-error">{error}</p>}
        <footer><button type="button" onClick={closeDialog}>{vi ? 'Hủy' : 'Cancel'}</button><button type="submit" className="field-primary" disabled={busy || (dialog?.kind === 'new' && !name.trim())}>{busy ? (vi ? 'Đang lưu…' : 'Saving…') : dialog?.kind === 'move' ? (vi ? 'Di chuyển' : 'Move page') : (vi ? 'Tạo trang' : 'Create page')}</button></footer>
      </form>
    </dialog>
  </div>;
}
