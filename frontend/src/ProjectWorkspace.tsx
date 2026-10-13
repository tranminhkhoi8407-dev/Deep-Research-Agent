import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Copy, FileText, History, LayoutDashboard, Link2, LoaderCircle, LogOut, MessageCircle, MoreHorizontal, NotebookPen, Palette, PanelLeft, Plus, RotateCcw, Search, ShieldCheck, Star, Trash2, Users, X } from 'lucide-react';
import { displayName, type Appearance } from './Auth';
import type { CollaborationProps, PageDetail, PageWorkspace, ProjectDetail, ProjectPage } from './CollaborationHub';
import type { NotebookPageAction } from './NotebookPageIcon';
import { NotebookPageIcon } from './NotebookPageIcon';
import { NotebookSearch, useNotebookConfirm } from './NotebookTools';
import { NotebookSidebarEdge, useNotebookSidebar } from './NotebookSidebar';
import { NotebookTabs, type TabControls } from './NotebookTabs';
import { NotebookPageChrome } from './NotebookPageChrome';
import { notebookApi as api, NotebookApiError, notebookError } from './notebookApi';
import { closeTab, restoreTabs, stepTab, tabLimit, visitTab, type TabState } from './workspaceTabs';
import { isProjectPageHash, projectHash, projectPaneAllowed, projectTree, projectWorkspaceRoute, restoreProjectMemory, type ProjectPane, type ProjectRoute } from './projectNavigation';
import { pageAncestors, pageDescendants } from './fieldNavigation';
import { domains } from './DomainHub';
import './FieldWorkspace.css';
import './NotebookChrome.css';
import './ProjectWorkspace.css';

type ToolPane = Exclude<ProjectPane, 'overview' | 'pages' | 'archived'>;
type Props = CollaborationProps & {
  route: ProjectRoute;
  routeHash: string;
  renderPage: (pageId: string, workspace: PageWorkspace, onOpen: (id: string) => void, onBack: () => void) => ReactNode;
  renderTools: (detail: ProjectDetail, pane: ToolPane, onChanged: (detail: ProjectDetail) => void) => ReactNode;
};
type Dialog = { kind: 'new' | 'rename' | 'move' | 'icon'; target?: string; newTab?: boolean };
const icons = ['', '∑', '⚛', '⚗', '🧬', '✦', '📖', '🔬', '💡', '🎯', '📝', '📊'];
const covers = ['none', 'indigo', 'ocean', 'amber', 'forest', 'aurora'];
const pageHash = (id: string) => `#/collab/page/${id}`;
const workspaceError = (reason: unknown, vi: boolean) => reason instanceof NotebookApiError && [403, 404].includes(reason.status)
  ? vi ? 'Không mở được trang hoặc dự án. Nội dung có thể đã được lưu trữ hoặc bạn không còn quyền truy cập.' : 'Unable to open this page or project. It may be archived or you may no longer have access.'
  : notebookError(reason, vi);

export function ProjectWorkspace(props: Props) {
  const { apiBase, user, language, route, routeHash } = props, vi = language === 'vi';
  const [project, setProject] = useState<ProjectDetail | null>(null), [page, setPage] = useState<PageDetail | null>(null);
  const [pane, setPane] = useState<ProjectPane>('overview'), [loading, setLoading] = useState(true), [denied, setDenied] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()), [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [visitedTools, setVisitedTools] = useState<ToolPane[]>([]), [tabs, setTabs] = useState<TabState>(() => restoreTabs(null));
  const [dialog, setDialog] = useState<Dialog | null>(null), [name, setName] = useState(''), [parent, setParent] = useState('');
  const [picker, setPicker] = useState(false), [pickerQuery, setPickerQuery] = useState(''), [activityOpen, setActivityOpen] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const sidebar = useNotebookSidebar(user.id), sidebarRef = useRef(sidebar); sidebarRef.current = sidebar;
  const shell = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null), dialogRef = useRef<HTMLDialogElement>(null), pickerRef = useRef<HTMLDialogElement>(null);
  const [ask, confirmation] = useNotebookConfirm(language);
  const current = useRef({ project, page, pane }); current.current = { project, page, pane };
  const generation = useRef(0), mutation = useRef(false), sync = useRef(false), titleDirty = useRef(false), committedHash = useRef(routeHash);
  const pendingTabs = useRef<{ hash: string; state: TabState } | null>(null);
  const tabState = useRef(tabs); tabState.current = tabs;
  const scroll = useRef<Record<string, number>>({}), memoryScope = useRef(''), scrollTimer = useRef<ReturnType<typeof setTimeout>>();
  const drawerFocus = useRef<HTMLElement | null>(null);
  const storageKey = (id: string) => `nexora-project-workspace:${user.id}:${id}`;
  const tabsKey = (id: string) => `nexora-project-tabs:${user.id}:${id}`;
  const projectId = project?.project.id || page?.project.id || '';
  const access = project?.project.my_access || 0, canOrganize = access >= 3, canManage = access >= 4;
  const pages = project?.pages || (page ? [page.page] : []);
  const active = page ? { ...page.page, ...project?.pages.find(item => item.id === page.page.id) } : null;
  const domain = domains.find(item => item.id === (project?.project.field || page?.project.field)), DomainIcon = domain?.icon || BookOpen;
  const persistMemory = useCallback(() => {
    const data = current.current, id = data.project?.project.id;
    if (!id || memoryScope.current !== id) return;
    try { sessionStorage.setItem(storageKey(id), JSON.stringify({ pageId: data.page?.page.id, scroll: scroll.current, collapsed: [...collapsed], toolsCollapsed })); } catch { /* Optional local presentation state. */ }
  }, [user.id, collapsed, toolsCollapsed]);
  const memoryWriter = useRef(persistMemory); memoryWriter.current = persistMemory;

  useEffect(() => {
    const epoch = ++generation.current;
    let cancelled = false;
    const load = async () => {
      const previous = current.current;
      const changesDocument = (route.pageId && route.pageId !== previous.page?.page.id) || (route.projectId && route.projectId !== previous.page?.project.id);
      if (previous.page && changesDocument && previous.page.page.my_access >= 3 && (!sync.current || titleDirty.current)) {
        const accepted = await ask(vi ? 'Trang đang có thay đổi chưa được xác nhận lưu. Bạn vẫn muốn đổi trang? Bản nháp nội dung được giữ trong phiên này; tên trang chưa lưu có thể mất.' : 'This page has changes not yet confirmed saved. Switch anyway? The content draft is retained in this session; an unsaved title may be lost.');
        if (cancelled || epoch !== generation.current) return;
        if (!accepted) { pendingTabs.current = null; window.history.replaceState({}, '', committedHash.current); window.dispatchEvent(new Event('hashchange')); return; }
      }
      memoryWriter.current(); setLoading(true); setError('');
      let nextPage: PageDetail | null = route.pageId ? await api<PageDetail>(apiBase, `/pages/${route.pageId}`) : null;
      if (cancelled || epoch !== generation.current) return;
      if (route.projectId && nextPage && nextPage.project.id !== route.projectId) throw new Error(vi ? 'Trang không thuộc dự án này.' : 'The page does not belong to this project.');
      const id = route.projectId || nextPage!.project.id;
      // A direct page grant never licenses project metadata, its tree or its utilities.
      const nextProject = nextPage && !nextPage.project.my_access ? null : await api<ProjectDetail>(apiBase, `/projects/${id}`);
      if (cancelled || epoch !== generation.current) return;
      if (!nextProject && route.projectId) throw new Error(vi ? 'Bạn chỉ được chia sẻ trang, không có quyền vào dự án.' : 'You have page-only access, not project access.');
      let nextTabs = tabState.current;
      let restored: ReturnType<typeof restoreProjectMemory> | null = null;
      if (memoryScope.current !== id) {
        let raw: unknown = null;
        try { raw = JSON.parse(sessionStorage.getItem(storageKey(id)) || 'null'); } catch { /* Invalid stored state is discarded. */ }
        restored = restoreProjectMemory(raw, new Set(nextProject?.pages.map(item => item.id) || []));
        let restoredTabs = restoreTabs(null);
        if (nextProject) {
          const allowed = new Set(nextProject.pages.map(item => pageHash(item.id)));
          try { restoredTabs = restoreTabs(JSON.parse(sessionStorage.getItem(tabsKey(id)) || 'null'), value => typeof value === 'string' && allowed.has(value)); } catch { /* Safe empty tab set. */ }
        }
        nextTabs = restoredTabs;
        if (!nextPage && restored.pageId) {
          try { nextPage = await api<PageDetail>(apiBase, `/pages/${restored.pageId}`); }
          catch (reason) { if (!(reason instanceof NotebookApiError) || ![403, 404].includes(reason.status)) throw reason; }
        }
      } else if (!nextPage && previous.page && nextProject?.pages.some(item => item.id === previous.page!.page.id)) {
        nextPage = previous.page;
      }
      if (cancelled || epoch !== generation.current) return;
      if (restored) {
        scroll.current = restored.scroll; setCollapsed(new Set(restored.collapsed)); setToolsCollapsed(restored.toolsCollapsed); setVisitedTools([]);
      }
      memoryScope.current = id;
      if (nextPage?.page.id !== previous.page?.page.id) { sync.current = false; titleDirty.current = false; }
      setProject(nextProject); setPage(nextPage); setDenied(false);
      const nextPane = projectPaneAllowed(route.pane, nextProject?.project.my_access || 0) ? route.pane : nextProject ? 'overview' : 'pages';
      setPane(nextPane); setMobile(false); committedHash.current = routeHash;
      if (!nextProject) { nextTabs = restoreTabs(null); setVisitedTools([]); }
      if (pendingTabs.current?.hash === routeHash) { nextTabs = pendingTabs.current.state; pendingTabs.current = null; }
      else if (nextPage && nextPane === 'pages') nextTabs = visitTab(nextTabs, { hash: pageHash(nextPage.page.id), title: nextPage.page.title, icon: nextPage.page.icon || '' }, undefined, isProjectPageHash);
      const allowedTabs = new Set(nextProject ? nextProject.pages.map(item => pageHash(item.id)) : nextPage ? [pageHash(nextPage.page.id)] : []);
      nextTabs = restoreTabs(nextTabs, value => typeof value === 'string' && allowedTabs.has(value));
      setTabs(nextTabs);
      if (['discussion', 'meetings', 'tasks', 'evidence', 'members', 'activity', 'settings'].includes(nextPane)) setVisitedTools(previousTools => [...new Set([...previousTools, nextPane as ToolPane])]);
    };
    void load().catch(reason => {
      if (cancelled || epoch !== generation.current) return;
      pendingTabs.current = null; setError(workspaceError(reason, vi));
      const unavailable = reason instanceof NotebookApiError && [401, 403, 404].includes(reason.status);
      if (unavailable || !current.current.project && !current.current.page) { setDenied(true); setProject(null); setPage(null); setTabs(restoreTabs(null)); setVisitedTools([]); }
    }).finally(() => { if (!cancelled && epoch === generation.current) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiBase, routeHash, user.id, retry]);

  const acceptProject = useCallback((next: ProjectDetail) => {
    if (next.project.id !== current.current.project?.project.id) return;
    setProject(next);
    const allowed = new Set(next.pages.map(item => pageHash(item.id)));
    setTabs(previous => {
      const clean = restoreTabs(previous, value => typeof value === 'string' && allowed.has(value));
      return { ...clean, tabs: clean.tabs.map(tab => ({ ...tab, history: tab.history.map(entry => {
        const item = next.pages.find(item => pageHash(item.id) === entry.hash)!;
        return { ...entry, title: item.title, icon: item.icon || '' };
      }) })) };
    });
    if (current.current.page && !next.pages.some(item => item.id === current.current.page!.page.id)) { setPage(null); setPane('overview'); }
    if (!projectPaneAllowed(current.current.pane, next.project.my_access)) setPane('overview');
  }, []);
  const refresh = useCallback(async () => {
    const id = current.current.project?.project.id;
    if (!id) {
      const pageId = current.current.page?.page.id;
      if (!pageId) return;
      try { const next = await api<PageDetail>(apiBase, `/pages/${pageId}`); if (pageId === current.current.page?.page.id) setPage(next); }
      catch (reason) {
        if (pageId !== current.current.page?.page.id) return;
        if (reason instanceof NotebookApiError && [401, 403, 404].includes(reason.status)) { setPage(null); setTabs(restoreTabs(null)); setDenied(true); }
        setError(workspaceError(reason, vi));
      }
      return;
    }
    try { acceptProject(await api<ProjectDetail>(apiBase, `/projects/${id}`)); setError(''); }
    catch (reason) {
      if (id !== current.current.project?.project.id) return;
      if (reason instanceof NotebookApiError && [401, 403, 404].includes(reason.status)) {
        const pageId = current.current.page?.page.id;
        setProject(null); setTabs(restoreTabs(null)); setVisitedTools([]);
        try {
          if (!pageId) throw reason;
          const remaining = await api<PageDetail>(apiBase, `/pages/${pageId}`);
          setPage(remaining); setPane('pages'); window.location.hash = pageHash(pageId);
        } catch { setPage(null); setDenied(true); }
      }
      setError(workspaceError(reason, vi));
    }
  }, [apiBase, acceptProject, vi]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !mutation.current) void refresh(); }, 12000);
    const focus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', focus); window.addEventListener('nexora:social-changed', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); window.removeEventListener('nexora:social-changed', focus); };
  }, [refresh]);
  useEffect(() => { if (projectId && project) { try { sessionStorage.setItem(tabsKey(projectId), JSON.stringify(tabs)); } catch { /* Optional. */ } } }, [tabs, projectId, !!project]);
  useEffect(() => { persistMemory(); }, [persistMemory, page?.page.id]);
  useEffect(() => () => { clearTimeout(scrollTimer.current); memoryWriter.current(); generation.current++; }, []);
  useEffect(() => {
    if (pane !== 'pages' || !page) return;
    const element = canvas.current, offset = scroll.current[page.page.id] || 0;
    if (!element) return;
    let done = false;
    const restore = () => { if (done) return; element.scrollTop = offset; if (element.scrollHeight - element.clientHeight >= offset) { done = true; observer.disconnect(); } };
    const observer = new ResizeObserver(restore), contents = element.firstElementChild;
    if (contents) observer.observe(contents); restore();
    const stop = () => { done = true; observer.disconnect(); };
    element.addEventListener('wheel', stop, { once: true }); element.addEventListener('pointerdown', stop, { once: true });
    const timer = setTimeout(stop, 5000);
    return () => { stop(); clearTimeout(timer); element.removeEventListener('wheel', stop); element.removeEventListener('pointerdown', stop); };
  }, [pane, page?.page.id]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === 'Backslash' && !event.repeat) { event.preventDefault(); sidebarRef.current.setCollapsed(value => !value); setMobile(value => window.innerWidth <= 780 ? !value : false); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); sidebarRef.current.setCollapsed(false); setMobile(true); setTimeout(() => shell.current?.querySelector<HTMLInputElement>('.notebook-search input')?.focus(), 0); }
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { setMobile(false); shell.current?.querySelector<HTMLButtonElement>('.field-mobile-menu')?.focus(); }
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, []);
  useEffect(() => { if (dialog) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [dialog]);
  useEffect(() => { if (picker) pickerRef.current?.showModal(); else pickerRef.current?.close(); }, [picker]);
  useEffect(() => { if (pane !== 'pages') setActivityOpen(false); }, [pane]);
  useEffect(() => { setPeekId(null); }, [pane, page?.page.id]);
  useEffect(() => {
    if (!peekId) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setPeekId(null); };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, [peekId]);
  useEffect(() => {
    const leaveWorkspace = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      const hash = anchor?.getAttribute('href'), active = current.current.page;
      if (!anchor || !shell.current?.contains(anchor) || !hash?.startsWith('#/') || projectWorkspaceRoute(hash) || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || !active || active.page.my_access < 3 || sync.current && !titleDirty.current) return;
      event.preventDefault(); event.stopPropagation();
      void ask(vi ? 'Trang vẫn còn thay đổi chưa được xác nhận lưu. Rời workspace? Bản nháp nội dung được giữ trong phiên này; tên trang chưa lưu có thể mất.' : 'This page still has changes not yet confirmed saved. Leave the workspace? The content draft remains in this session; an unsaved title may be lost.').then(accepted => { if (accepted) { memoryWriter.current(); window.location.hash = hash; } });
    };
    document.addEventListener('click', leaveWorkspace, true);
    return () => document.removeEventListener('click', leaveWorkspace, true);
  }, [ask, vi]);
  useEffect(() => {
    // React 18's DOM typings predate inert. Keep a collapsed drawer out of keyboard focus.
    shell.current?.querySelector('aside')?.toggleAttribute('inert', window.innerWidth <= 780 && !mobile || window.innerWidth > 780 && sidebar.collapsed);
    const main = shell.current?.querySelector('.project-main'), drawerOpen = window.innerWidth <= 780 && mobile;
    main?.toggleAttribute('inert', drawerOpen);
    if (drawerOpen) {
      drawerFocus.current = document.activeElement as HTMLElement;
      shell.current?.querySelector<HTMLAnchorElement>('.field-sidebar-home a')?.focus();
    } else if (drawerFocus.current) {
      shell.current?.querySelector<HTMLButtonElement>('.field-mobile-menu')?.focus(); drawerFocus.current = null;
    }
  }, [mobile, sidebar.collapsed, sidebar.width]);

  const go = (next: string) => { if (!loading) { memoryWriter.current(); window.location.hash = next; } };
  const selectPane = (next: ProjectPane) => {
    if (!project || !projectPaneAllowed(next, access)) return;
    const id = page?.page.id || project.pages.find(item => item.opened_at)?.id || project.pages[0]?.id;
    go(projectHash(projectId, next === 'pages' && !id ? 'overview' : next, id));
  };
  const open = (id: string) => go(pageHash(id));
  const run = async (work: () => Promise<void>) => {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError('');
    try { await work(); await refresh(); } catch (reason) { setError(notebookError(reason, vi)); }
    finally { mutation.current = false; setBusy(false); }
  };
  const patch = (id: string, changes: object) => api(apiBase, `/pages/${id}`, { method: 'PATCH', body: JSON.stringify(changes) });
  const create = (parentId: string | null, newTab = false) => { if (!canOrganize) return; setParent(parentId || ''); setName(''); setDialog({ kind: 'new', newTab }); };
  const openTab = (item: ProjectPage) => {
    if (!project || !project.pages.some(candidate => candidate.id === item.id) || tabs.tabs.length >= tabLimit) return;
    const next = visitTab(tabs, { hash: pageHash(item.id), title: item.title, icon: item.icon || '' }, crypto.randomUUID(), isProjectPageHash);
    if (routeHash === pageHash(item.id)) setTabs(next); else pendingTabs.current = { hash: pageHash(item.id), state: next };
    setPicker(false); open(item.id);
  };
  const archive = (id: string) => {
    const target = pages.find(item => item.id === id);
    if (!target || !canManage || id === project?.home_page_id) return;
    void run(async () => {
      if (!await ask(vi ? `Lưu trữ “${target.title}” và tất cả trang con? Có thể khôi phục cả nhánh trong mục Đã lưu trữ.` : `Archive “${target.title}” and its subpages? Restore the branch from Archived pages.`)) return;
      await api(apiBase, `/pages/${id}/archive`, { method: 'POST' });
      if (page && pageDescendants(pages, id).has(page.page.id)) { setPage(null); sync.current = true; titleDirty.current = false; go(projectHash(projectId)); }
    });
  };
  const action = (id: string, kind: NotebookPageAction) => {
    const target = pages.find(item => item.id === id); if (!target || busy || loading) return;
    shell.current?.querySelectorAll<HTMLDetailsElement>('.field-tree-menu[open]').forEach(menu => { menu.open = false; });
    if (kind === 'peek') { setPeekId(id); setMobile(false); return; }
    if (kind === 'favorite') { void run(async () => {
      await api(apiBase, `/pages/${id}/preference`, { method: 'PUT', body: JSON.stringify({ favorite: !target.favorite }) });
      setPage(previous => previous?.page.id === id ? { ...previous, page: { ...previous.page, favorite: !target.favorite } } : previous);
    }); return; }
    if (!canOrganize) return;
    if (kind === 'rename' || kind === 'icon' || kind === 'move') {
      if (kind === 'move' && id === project?.home_page_id) return;
      setName(target.title); setParent(target.parent_id || ''); setDialog({ kind, target: id });
    }
    if (kind === 'duplicate') void run(async () => { const result = await api<{ page: ProjectPage }>(apiBase, `/pages/${id}/duplicate`, { method: 'POST' }); await refresh(); open(result.page.id); });
    if (kind === 'trash') archive(id);
  };
  const reorder = (id: string, direction: number) => {
    const target = pages.find(item => item.id === id); if (!target || !canOrganize) return;
    const siblings = pages.filter(item => item.parent_id === target.parent_id).map(item => item.id), index = siblings.indexOf(id), next = index + direction;
    if (next < 0 || next >= siblings.length) return;
    [siblings[index], siblings[next]] = [siblings[next], siblings[index]];
    void run(async () => { await api(apiBase, `/projects/${projectId}/page-order`, { method: 'PUT', body: JSON.stringify({ parent_id: target.parent_id, page_ids: siblings }) }); });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (!dialog || !project) return;
    void run(async () => {
      if (dialog.kind === 'new') {
        const result = await api<{ page: ProjectPage }>(apiBase, `/projects/${projectId}/pages`, { method: 'POST', body: JSON.stringify({ title: name.trim(), parent_id: parent || null }) });
        await refresh(); setDialog(null);
        if (dialog.newTab) pendingTabs.current = { hash: pageHash(result.page.id), state: visitTab(tabState.current, { hash: pageHash(result.page.id), title: result.page.title, icon: result.page.icon || '' }, crypto.randomUUID(), isProjectPageHash) };
        open(result.page.id);
      } else {
        await patch(dialog.target!, dialog.kind === 'move' ? { parent_id: parent || null } : { title: name.trim() }); setDialog(null);
      }
    });
  };
  const pageDetails = (next: PageDetail) => {
    if (next.page.id !== current.current.page?.page.id) return;
    setPage(next);
    if (!next.project.my_access) { setProject(null); setVisitedTools([]); setTabs(previous => restoreTabs(previous, value => value === pageHash(next.page.id))); setPane('pages'); return; }
    setProject(previous => previous ? { ...previous, pages: previous.pages.map(item => item.id === next.page.id ? { ...item, ...next.page, favorite: next.page.favorite ?? item.favorite, opened_at: item.opened_at } : item) } : previous);
  };
  const workspace: PageWorkspace = {
    header: active && <div className={`field-page-cover cover-${active.cover || 'none'}`}><div className="field-cover-decoration" aria-hidden="true"><DomainIcon size={100} strokeWidth={.7} /></div><span className="field-cover-icon"><NotebookPageIcon icon={active.icon} size={38} /></span>
      {(active.my_access || 0) >= 3 && <details className="field-customize"><summary><Palette size={15} />{vi ? 'Tùy chỉnh trang' : 'Customize page'}</summary><div><strong>{vi ? 'Biểu tượng' : 'Page icon'}</strong><div className="field-icon-options">{icons.map(icon => <button type="button" key={icon} disabled={busy} aria-label={icon || (vi ? 'Mặc định' : 'Default')} onClick={() => void run(async () => { await patch(active.id, { icon }); })}><NotebookPageIcon icon={icon} size={23} /></button>)}</div><strong>{vi ? 'Ảnh bìa' : 'Cover palette'}</strong><div className="field-cover-options">{covers.map(cover => <button type="button" key={cover} className={`cover-${cover}`} aria-label={cover} disabled={busy} onClick={() => void run(async () => { await patch(active.id, { cover }); })}>{cover === 'none' ? '×' : ''}</button>)}</div></div></details>}
    </div>,
    onChanged: () => void refresh(), onSync: value => { if (current.current.page?.page.id === page?.page.id) sync.current = value; }, onTitleDirty: value => { if (current.current.page?.page.id === page?.page.id) titleDirty.current = value; }, onDetails: pageDetails,
    onUnavailable: () => {
      if (current.current.page?.page.id !== page?.page.id) return;
      setPage(null); setProject(null); setVisitedTools([]); setTabs(restoreTabs(null)); setDenied(true); setError(vi ? 'Trang không còn khả dụng hoặc quyền truy cập đã thay đổi.' : 'The page is unavailable or its access has changed.');
    },
    pages, pageHref: pageHash, onPageAction: action, hideSharingPanel: true, showTools: true, showChildPages: !!project && !project.home_page_id,
    metadata: active ? { title: active.title, updated_at: active.updated_at, my_access: active.my_access || 0 } : undefined,
    ...(canOrganize ? {
      onCreateChild: () => create(page!.page.id), onCreateChildUnder: (id: string) => create(id),
      onConvertToPage: async (payload: import('./LiveResearchEditor').SubpageConversion) => {
        const result = await api<{ page: ProjectPage }>(apiBase, `/projects/${projectId}/pages`, { method: 'POST', body: JSON.stringify({ title: payload.title, parent_id: page!.page.id, link_in_parent: false }) });
        try { await api(apiBase, `/pages/${result.page.id}/initialize-blocks`, { method: 'POST', body: JSON.stringify({ update: payload.update, expected_revision: 0 }) }); }
        catch (reason) { if (canManage) await api(apiBase, `/pages/${result.page.id}/archive`, { method: 'POST' }).catch(() => {}); throw reason; }
        finally { await refresh(); }
        return result.page;
      },
    } : {}),
  };
  const tabControls: TabControls = {
    state: tabs,
    onSelect: id => {
      if (loading) return;
      const item = tabs.tabs.find(item => item.id === id); if (!item) return;
      const hash = item.history[item.index].hash, next = { ...tabs, active: id };
      if (routeHash === hash) setTabs(next); else { pendingTabs.current = { hash, state: next }; go(hash); }
    },
    onClose: id => {
      if (loading) return;
      const next = closeTab(tabs, id);
      if (id !== tabs.active) { setTabs(next); return; }
      const nextTab = next.tabs.find(item => item.id === next.active), hash = nextTab ? nextTab.history[nextTab.index].hash : project ? projectHash(projectId) : '#/collab';
      if (hash === routeHash) setTabs(next); else { pendingTabs.current = { hash, state: next }; go(hash); }
    },
    onStep: direction => {
      if (loading) return;
      const next = stepTab(tabs, direction), item = next.tabs.find(item => item.id === next.active);
      if (item) { pendingTabs.current = { hash: item.history[item.index].hash, state: next }; go(item.history[item.index].hash); }
    },
    onOpen: item => { const authorized = project?.pages.find(page => page.id === item.id); if (authorized) openTab(authorized); }, onResolved: () => {},
  };
  const navigation = [
    ['overview', LayoutDashboard, vi ? 'Tổng quan' : 'Overview'], ['pages', FileText, vi ? 'Trang nghiên cứu' : 'Pages'],
    ['discussion', MessageCircle, vi ? 'Thảo luận' : 'Discussion'], ['meetings', CalendarDays, vi ? 'Lịch họp & biên bản' : 'Meetings & minutes'],
    ['tasks', CheckCircle2, vi ? 'Việc cần làm' : 'Tasks'], ['evidence', Link2, vi ? 'Nguồn & paper' : 'Evidence'],
    ['members', Users, vi ? 'Thành viên' : 'Members'], ['activity', History, vi ? 'Hoạt động' : 'Activity'], ['settings', NotebookPen, vi ? 'Chi tiết dự án' : 'Details'],
  ] as const;
  const paneName = navigation.find(item => item[0] === pane)?.[2] || (vi ? 'Đã lưu trữ' : 'Archived pages');
  const menuFor = (item: ProjectPage) => <details className="field-tree-menu"><summary aria-label={`${vi ? 'Thao tác trang' : 'Page actions for'} ${item.title}`}><MoreHorizontal size={15} /></summary><div>
    <button type="button" onClick={() => action(item.id, 'favorite')}>{item.favorite ? vi ? 'Bỏ yêu thích' : 'Remove favorite' : vi ? 'Yêu thích' : 'Favorite'}</button>
    <button type="button" onClick={() => action(item.id, 'peek')}>{vi ? 'Mở bên cạnh' : 'Open beside'}</button>
    {canOrganize && <><button type="button" onClick={() => action(item.id, 'rename')}>{vi ? 'Đổi tên' : 'Rename'}</button><button type="button" onClick={() => action(item.id, 'icon')}>{vi ? 'Đổi biểu tượng' : 'Edit icon'}</button><button type="button" onClick={() => action(item.id, 'duplicate')}>{vi ? 'Nhân bản (không kèm trang con)' : 'Duplicate (without subpages)'}</button>{item.id !== project?.home_page_id && <button type="button" onClick={() => action(item.id, 'move')}>{vi ? 'Di chuyển đến…' : 'Move to…'}</button>}<button type="button" onClick={() => reorder(item.id, -1)}>{vi ? 'Đưa lên cùng cấp' : 'Move up among siblings'}</button><button type="button" onClick={() => reorder(item.id, 1)}>{vi ? 'Đưa xuống cùng cấp' : 'Move down among siblings'}</button></>}
    {canManage && item.id !== project?.home_page_id && <button type="button" onClick={() => archive(item.id)}>{vi ? 'Lưu trữ cả nhánh' : 'Archive branch'}</button>}
  </div></details>;
  const tree = projectTree(pages, collapsed).map(({ page: item, depth }) => {
    const children = pages.some(child => child.parent_id === item.id);
    return <div key={item.id} className={`field-tree-row ${pane === 'pages' && item.id === page?.page.id ? 'is-active' : ''}`} style={{ '--depth': Math.min(depth, 8) } as CSSProperties}
      draggable={canOrganize && !busy && item.id !== project?.home_page_id} onDragStart={event => { event.dataTransfer.setData('application/x-nexora-page', item.id); }}
      onDragOver={event => { if (canOrganize && event.dataTransfer.types.includes('application/x-nexora-page')) event.preventDefault(); }}
      onDrop={event => {
        event.preventDefault(); const id = event.dataTransfer.getData('application/x-nexora-page');
        if (!canOrganize || !pages.some(source => source.id === id) || id === project?.home_page_id || pageDescendants(pages, id).has(item.id)) return;
        void run(async () => { await patch(id, { parent_id: item.id }); setCollapsed(previous => { const next = new Set(previous); next.delete(item.id); return next; }); });
      }}>
      <button type="button" disabled={!children} aria-label={`${vi ? 'Mở / thu gọn' : 'Expand / collapse'} ${item.title}`} aria-expanded={children ? !collapsed.has(item.id) : undefined} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}>{children ? collapsed.has(item.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} /> : <span />}</button>
      <a href={pageHash(item.id)} aria-current={pane === 'pages' && item.id === page?.page.id ? 'page' : undefined} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) { event.preventDefault(); open(item.id); } }}><NotebookPageIcon icon={item.icon} size={16} /><span>{item.title}</span></a>
      {menuFor(item)}{canOrganize && <button type="button" className="field-tree-add" disabled={busy || loading} aria-label={`${vi ? 'Thêm trang con vào' : 'Add subpage to'} ${item.title}`} onClick={() => create(item.id)}><Plus size={14} /></button>}
    </div>;
  });

  return <div ref={shell} className={`field-notebook project-workspace field-tone-${domain?.id || 'artificial-intelligence'} ${sidebar.collapsed ? 'sidebar-collapsed' : ''} ${mobile ? 'sidebar-open' : ''} ${active?.full_width ? 'is-wide' : ''} ${activityOpen ? 'activity-open' : ''}`} style={{ '--field-sidebar-width': `${sidebar.width}px` } as CSSProperties}>
    {confirmation}
    {mobile && <button type="button" className="field-sidebar-scrim" aria-label={vi ? 'Đóng sidebar' : 'Close sidebar'} onClick={() => setMobile(false)} />}
    <aside id="project-sidebar" className="field-notebook__sidebar" aria-label={vi ? 'Điều hướng dự án' : 'Project navigation'}>
      <div className="field-sidebar-home"><a href="#/collab"><ArrowLeft size={14} />{vi ? 'Tất cả dự án' : 'All projects'}</a><button type="button" aria-label={vi ? 'Thu gọn sidebar' : 'Collapse sidebar'} onClick={() => { sidebar.setCollapsed(true); setMobile(false); shell.current?.querySelector<HTMLButtonElement>('.field-mobile-menu')?.focus(); }}><PanelLeft size={17} /></button></div>
      <div className="project-sidebar-identity"><span><DomainIcon size={22} /></span><div><small>{project ? vi ? 'Không gian dự án' : 'Project workspace' : vi ? 'Trang được chia sẻ' : 'Shared page'}</small><strong>{project?.project.name || page?.project.name || (vi ? 'Đang mở…' : 'Opening…')}</strong></div></div>
      {project?.project.group_id && <a className="field-sidebar-link" href={`#/collab/group/${project.project.group_id}`}><Users size={16} />{vi ? 'Mở không gian nhóm' : 'Open group space'}</a>}
      {project && <NotebookSearch apiBase={apiBase} language={language} projectId={projectId} onOpen={open} />}
      {project && <section className="project-utilities"><button type="button" className="project-section-label" aria-expanded={!toolsCollapsed} onClick={() => setToolsCollapsed(value => !value)}>{toolsCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}{vi ? 'TIỆN ÍCH DỰ ÁN' : 'PROJECT TOOLS'}</button><nav hidden={toolsCollapsed} aria-label={vi ? 'Tiện ích dự án' : 'Project tools'}>{navigation.filter(([id]) => projectPaneAllowed(id, access)).map(([id, Icon, label]) => <button type="button" key={id} disabled={loading} className={pane === id ? 'is-active' : ''} aria-current={pane === id ? 'page' : undefined} onClick={() => selectPane(id)}><Icon size={16} /><span>{label}</span></button>)}</nav></section>}
      <div className="field-sidebar-scroll project-tree-scroll">
        {pages.some(item => item.favorite) && <section className="field-shortcuts"><h3><Star size={12} />{vi ? 'Yêu thích' : 'Favorites'}</h3>{pages.filter(item => item.favorite).map(item => <a key={item.id} href={pageHash(item.id)} onClick={event => { event.preventDefault(); open(item.id); }}><NotebookPageIcon icon={item.icon} size={14} />{item.title}</a>)}</section>}
        <section><div className="project-tree-heading"><h3>{project ? vi ? 'Trang trong dự án' : 'Project pages' : vi ? 'Trang được chia sẻ' : 'Shared page'}</h3>{canOrganize && <button type="button" disabled={busy || loading} aria-label={vi ? 'Tạo trang cấp gốc' : 'Create top-level page'} onClick={() => create(null)}><Plus size={15} /></button>}</div>{tree}{!pages.length && <p className="project-sidebar-empty">{loading ? vi ? 'Đang mở…' : 'Opening…' : vi ? 'Chưa có trang.' : 'No pages yet.'}</p>}</section>
        {canOrganize && <button type="button" className="project-new-page" disabled={busy || loading} onClick={() => create(null)}><Plus size={15} />{vi ? 'Trang mới' : 'New page'}</button>}
      </div>
      <div className="field-sidebar-bottom project-sidebar-footer"><a href="#/library" className="field-sidebar-link"><BookOpen size={15} />{vi ? 'Thư viện bài báo' : 'Paper library'}</a><a href="#/fields/guide" className="field-sidebar-link"><BookOpen size={15} />{vi ? 'Hướng dẫn editor & LaTeX' : 'Editor & LaTeX guide'}</a>{canManage && <button type="button" onClick={() => selectPane('archived')}><Trash2 size={15} />{vi ? 'Đã lưu trữ' : 'Archived pages'}<span>{project?.archived_pages.length || 0}</span></button>}
        <details className="field-account"><summary><span className="field-account-avatar">{user.avatar_url ? <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" /> : displayName(user).slice(0, 1)}</span><strong>{displayName(user)}</strong><ChevronDown size={14} /></summary><div><a href="#/profile">{vi ? 'Hồ sơ cá nhân' : 'My profile'}<ArrowRight size={12} /></a>{props.onAppearanceChange && <label>{vi ? 'Giao diện' : 'Appearance'}<select value={props.appearance || 'system'} onChange={event => props.onAppearanceChange?.(event.target.value as Appearance)}><option value="system">{vi ? 'Theo hệ thống' : 'System'}</option><option value="light">{vi ? 'Sáng' : 'Light'}</option><option value="dark">{vi ? 'Tối' : 'Dark'}</option></select></label>}{props.onLanguageChange && <label>{vi ? 'Ngôn ngữ' : 'Language'}<select value={language} onChange={event => props.onLanguageChange?.(event.target.value as typeof language)}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>}{props.onLogout && <button type="button" onClick={props.onLogout}><LogOut size={14} />{vi ? 'Đăng xuất' : 'Sign out'}</button>}</div></details>
      </div>
    </aside>
    <NotebookSidebarEdge controls={sidebar} language={language} sidebarId="project-sidebar" />
    <div className="project-main">
      <div className="notebook-chrome-header"><NotebookTabs controls={tabControls} language={language} disabledAdd={!project || loading} onAdd={() => { setPickerQuery(''); setPicker(true); }} />
        <header className="field-topbar"><button type="button" className="field-mobile-menu" aria-label={vi ? 'Mở sidebar' : 'Open sidebar'} aria-controls="project-sidebar" aria-expanded={window.innerWidth <= 780 ? mobile : !sidebar.collapsed} onClick={() => { sidebar.setCollapsed(false); setMobile(value => window.innerWidth <= 780 ? !value : false); }}><PanelLeft size={19} /></button><nav className="field-breadcrumbs" aria-label="Breadcrumb">{project ? <a href={projectHash(projectId)} onClick={event => { event.preventDefault(); selectPane('overview'); }}><DomainIcon size={16} /><span>{project.project.name}</span></a> : <span>{vi ? 'Trang được chia sẻ' : 'Shared page'}</span>}{pane === 'pages' && active ? pageAncestors(pages, active.id).map(item => <span key={item.id}><ChevronRight size={13} /><a href={pageHash(item.id)} onClick={event => { event.preventDefault(); open(item.id); }} aria-current={item.id === active.id ? 'page' : undefined}>{item.title}</a></span>) : <span><ChevronRight size={13} />{paneName}</span>}</nav>
          {pane === 'pages' && active && !denied && <div className="field-topbar-actions"><NotebookPageChrome key={active.id} apiBase={apiBase} pageId={active.id} title={active.title} updatedAt={active.updated_at} language={language} user={user} onPanelChange={setActivityOpen} /><button type="button" aria-label={vi ? 'Yêu thích trang' : 'Favorite page'} className={active.favorite ? 'is-favorite' : ''} aria-pressed={!!active.favorite} disabled={busy || loading} onClick={() => action(active.id, 'favorite')}><Star size={17} fill={active.favorite ? 'currentColor' : 'none'} /></button><details className="field-page-menu"><summary aria-label={vi ? 'Thao tác trang' : 'Page actions'}><MoreHorizontal size={19} /></summary><div>{canOrganize && <><button type="button" onClick={() => create(active.id)}><Plus size={15} />{vi ? 'Tạo trang con' : 'Create subpage'}</button><button type="button" onClick={() => action(active.id, 'duplicate')}><Copy size={15} />{vi ? 'Nhân bản trang' : 'Duplicate page'}</button>{active.id !== project?.home_page_id && <button type="button" onClick={() => action(active.id, 'move')}><ArrowRight size={15} />{vi ? 'Di chuyển trang' : 'Move page'}</button>}</>}{(active.my_access || 0) >= 3 && <label><input type="checkbox" checked={!!active.full_width} disabled={busy} onChange={event => void run(async () => { await patch(active.id, { full_width: event.target.checked }); })} />{vi ? 'Toàn chiều rộng' : 'Full width'}</label>}{canManage && active.id !== project?.home_page_id && <button type="button" onClick={() => archive(active.id)}><Trash2 size={15} />{vi ? 'Lưu trữ cả nhánh' : 'Archive branch'}</button>}</div></details></div>}
        </header>
      </div>
      {error && <div className="field-error" role="alert"><span>{error}</span><button type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}><RotateCcw size={15} />{vi ? 'Thử lại' : 'Retry'}</button></div>}
      {loading && <div className="project-loading" role="status"><LoaderCircle className="spin" size={16} />{vi ? 'Đang mở workspace…' : 'Opening workspace…'}</div>}
      {denied ? <section className="project-unavailable"><ShieldCheck size={25} /><h2>{vi ? 'Không mở được không gian này' : 'This workspace is unavailable'}</h2><p>{vi ? 'Trang có thể đã được lưu trữ hoặc quyền truy cập đã thay đổi.' : 'The page may be archived or your access may have changed.'}</p><a href="#/collab">{vi ? 'Về danh sách dự án' : 'Back to projects'}</a></section> : <>
        <div ref={canvas} className="field-notebook__canvas project-page-canvas" hidden={pane !== 'pages' || !page} onScroll={event => {
          if (current.current.pane !== 'pages' || !current.current.page) return;
          scroll.current[current.current.page.page.id] = event.currentTarget.scrollTop;
          clearTimeout(scrollTimer.current); scrollTimer.current = setTimeout(() => memoryWriter.current(), 200);
        }}>{page && props.renderPage(page.page.id, workspace, open, () => selectPane('overview'))}</div>
        <div className="project-tool-canvas" hidden={pane === 'pages'}>
          {pane === 'overview' && project && <section className="project-overview">
            <span className="field-eyebrow">{domain?.[language].title} / PROJECT</span>
            <h1>{project.project.name}</h1>
            <p className="project-goal">{project.project.description || (vi ? 'Thêm mục tiêu ở Chi tiết dự án để mọi người cùng định hướng.' : 'Add a goal in Details to align the team.')}</p>
            <div className="project-overview-meta">
              <span><ShieldCheck size={15} />{project.project.visibility === 'group' ? vi ? 'Thành viên nhóm' : 'Group members' : vi ? 'Chỉ người được mời' : 'Invited only'}</span>
              <select aria-label={vi ? 'Trạng thái dự án' : 'Project status'} value={project.project.status} disabled={!canManage || busy} onChange={event => {
                const status = event.target.value;
                void run(async () => { if (status === 'archived' && !await ask(vi ? 'Lưu trữ dự án này?' : 'Archive this project?')) return; await api(apiBase, `/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ status }) }); });
              }}>
                {[['planning', vi ? 'Lập kế hoạch' : 'Planning'], ['active', vi ? 'Đang làm' : 'Active'], ['review', vi ? 'Phản biện' : 'Review'], ['complete', vi ? 'Hoàn thành' : 'Complete'], ...(!project.home_page_id ? [['archived', vi ? 'Lưu trữ' : 'Archived']] : [])].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="project-overview-heading">
              <h2>{vi ? 'Tiếp tục nghiên cứu' : 'Continue researching'}</h2>
              {canOrganize && <button type="button" disabled={busy || loading} onClick={() => create(null)}><Plus size={16} />{vi ? 'Thêm trang' : 'Add page'}</button>}
            </div>
            {project.pages.length ? <div className="project-overview-pages">
              {project.pages.filter(item => !item.parent_id).map(item => <div className="project-overview-page-row" key={item.id}>
                <button type="button" onClick={() => open(item.id)}><NotebookPageIcon icon={item.icon} size={19} /><span className="project-page-label">{item.title}</span><ArrowRight size={15} /></button>
                {canOrganize && <button type="button" disabled={busy || loading} aria-label={`${vi ? 'Thêm trang con vào' : 'Add subpage to'} ${item.title}`} title={vi ? 'Thêm trang con' : 'Add subpage'} onClick={() => create(item.id)}><Plus size={16} /></button>}
              </div>)}
            </div> : <div className="project-empty"><FileText size={26} /><p>{vi ? 'Bắt đầu với trang đầu tiên của dự án bằng nút Thêm trang ở trên.' : 'Start with your first project page using Add page above.'}</p></div>}
            <footer>
              <button type="button" onClick={() => selectPane('tasks')}><CheckCircle2 size={17} />{project.tasks.filter(item => item.status !== 'done').length} {vi ? 'việc chưa xong' : 'open tasks'}</button>
              <button type="button" onClick={() => selectPane('evidence')}><BookOpen size={17} />{project.evidence.length} {vi ? 'nguồn chung' : 'shared sources'}</button>
            </footer>
          </section>}
          {project && visitedTools.filter(item => projectPaneAllowed(item, access)).map(item => <div key={item} hidden={pane !== item}>{props.renderTools(project, item, acceptProject)}</div>)}
          {pane === 'archived' && project && canManage && <section className="project-overview"><h1>{vi ? 'Trang đã lưu trữ' : 'Archived pages'}</h1><p>{vi ? 'Khôi phục trang cha để đưa cả nhánh trở lại. Trang đã được lưu trữ trước đó không tự khôi phục.' : 'Restore a parent to restore its branch. Pages archived earlier remain archived.'}</p>{project.archived_pages.map(item => <div className="project-archived-row" key={item.id}><FileText size={17} /><span>{item.title}</span><button type="button" disabled={busy} onClick={() => void run(async () => { await api(apiBase, `/pages/${item.id}/restore`, { method: 'POST' }); })}><RotateCcw size={15} />{vi ? 'Khôi phục' : 'Restore'}</button></div>)}{!project.archived_pages.length && <p>{vi ? 'Chưa có trang đã lưu trữ.' : 'No archived pages.'}</p>}</section>}
        </div>
      </>}
    </div>
    {peekId && pages.some(item => item.id === peekId) && <aside className="field-side-peek" aria-label={vi ? 'Xem trang bên cạnh' : 'Page side peek'}>
      <header><a href={pageHash(peekId)} onClick={event => { event.preventDefault(); open(peekId); }}>{vi ? 'Mở toàn trang' : 'Open full page'}<ArrowRight size={15} /></a><button type="button" aria-label={vi ? 'Đóng xem bên cạnh' : 'Close side peek'} onClick={() => setPeekId(null)}><X size={20} /></button></header>
      <div>{props.renderPage(peekId, {
        header: null, pages, pageHref: pageHash, onPageAction: action, hideSharingPanel: true,
        onChanged: () => void refresh(), onSync: () => {},
        onUnavailable: () => setPeekId(null),
        onDetails: next => setProject(previous => previous ? { ...previous, pages: previous.pages.map(item => item.id === next.page.id ? { ...item, ...next.page, opened_at: item.opened_at } : item) } : previous),
        ...(canOrganize ? { onCreateChild: () => create(peekId), onCreateChildUnder: (id: string) => create(id) } : {}),
      }, id => { if (pages.some(item => item.id === id)) setPeekId(id); }, () => setPeekId(null))}</div>
    </aside>}
    <dialog ref={dialogRef} className="field-dialog" onCancel={event => { if (busy) event.preventDefault(); else setDialog(null); }} onClick={event => { if (!busy && event.target === event.currentTarget) setDialog(null); }}>
      <form onSubmit={submit}>
        <header><NotebookPageIcon size={23} /><h2>{dialog?.kind === 'move' ? vi ? 'Di chuyển trang' : 'Move page' : dialog?.kind === 'rename' ? vi ? 'Đổi tên trang' : 'Rename page' : dialog?.kind === 'icon' ? vi ? 'Biểu tượng trang' : 'Page icon' : vi ? 'Tạo trang mới' : 'Create page'}</h2><button type="button" disabled={busy} aria-label={vi ? 'Đóng' : 'Close'} onClick={() => setDialog(null)}><X size={18} /></button></header>
        {dialog?.kind === 'icon' ? <div className="field-dialog-icons">{icons.map(icon => <button type="button" key={icon} disabled={busy} aria-label={icon || (vi ? 'Mặc định' : 'Default')} onClick={() => void run(async () => { await patch(dialog.target!, { icon }); setDialog(null); })}><NotebookPageIcon icon={icon} size={24} /></button>)}</div> : <>
          {dialog?.kind !== 'move' && <label>{vi ? 'Tên trang' : 'Page title'}<input autoFocus required maxLength={120} disabled={busy} aria-label={vi ? 'Tên trang' : 'Page title'} value={name} onChange={event => setName(event.target.value)} /></label>}
          {dialog?.kind !== 'rename' && <label>{vi ? 'Trang cha' : 'Parent page'}<select disabled={busy} aria-label={vi ? 'Trang cha' : 'Parent page'} value={parent} onChange={event => setParent(event.target.value)}><option value="">{vi ? 'Cấp gốc — cùng cấp với các trang gốc' : 'Top level — alongside other root pages'}</option>{pages.filter(item => dialog?.kind !== 'move' || !pageDescendants(pages, dialog.target!).has(item.id)).map(item => <option key={item.id} value={item.id}>{pageAncestors(pages, item.id).map(ancestor => ancestor.title).join(' / ')}</option>)}</select></label>}
        </>}
        <p><ShieldCheck size={15} />{vi ? 'Trang mới không tự nhận lời mời riêng của trang cha. Quyền từ dự án vẫn áp dụng.' : 'New pages do not inherit direct page invitations. Project access still applies.'}</p>
        {error && <p role="alert">{error}</p>}
        <footer><button type="button" disabled={busy} onClick={() => setDialog(null)}>{vi ? 'Hủy' : 'Cancel'}</button>{dialog?.kind !== 'icon' && <button type="submit" className="field-primary" disabled={busy || (dialog?.kind !== 'move' && !name.trim())}>{busy ? vi ? 'Đang lưu…' : 'Saving…' : vi ? 'Lưu và tiếp tục' : 'Save and continue'}</button>}</footer>
      </form>
    </dialog>
    <dialog ref={pickerRef} className="field-dialog project-tab-picker" onCancel={() => setPicker(false)} onClick={event => { if (event.target === event.currentTarget) setPicker(false); }}><header><Search size={19} /><h2>{vi ? 'Mở trang trong tab mới' : 'Open page in new tab'}</h2><button type="button" aria-label={vi ? 'Đóng' : 'Close'} onClick={() => setPicker(false)}><X size={19} /></button></header><input autoFocus aria-label={vi ? 'Tìm trang trong dự án này' : 'Find a page in this project'} placeholder={vi ? 'Tìm trang trong dự án này…' : 'Find a page in this project…'} value={pickerQuery} onChange={event => setPickerQuery(event.target.value)} maxLength={120} /><div className="project-picker-pages">{pages.filter(item => item.title.toLocaleLowerCase().includes(pickerQuery.toLocaleLowerCase())).map(item => <button type="button" key={item.id} disabled={tabs.tabs.length >= tabLimit} onClick={() => openTab(item)}><NotebookPageIcon icon={item.icon} size={18} />{item.title}</button>)}</div>{canOrganize && <button type="button" className="field-primary" disabled={tabs.tabs.length >= tabLimit} onClick={() => { setPicker(false); create(null, true); }}><Plus size={16} />{vi ? 'Tạo trang mới' : 'Create page'}</button>}{tabs.tabs.length >= tabLimit && <p role="status">{vi ? 'Đóng bớt tab trước khi mở thêm.' : 'Close a tab before opening another.'}</p>}</dialog>
  </div>;
}
