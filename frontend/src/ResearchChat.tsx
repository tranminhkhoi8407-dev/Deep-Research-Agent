import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, Bell, ChevronDown, FileText, Folder, Globe2, LayoutGrid, Library, LoaderCircle, LogOut, MessageSquare, MoreVertical, NotebookText, PanelLeft, Paperclip, Pin, Plus, Search, Send, Sparkles, Square, Upload, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BrandMark } from './BrandMark';
import { displayName, type Appearance, type AuthUser } from './Auth';
import type { ResearchOptions } from './ResearchSetup';
import type { AppView, Language } from './ProductViews';
import { chatModeLabel, defaultAttachmentLimits, defaultOpenCodeModel, errorLabel, fileSize, isImageFile, isPdfFile, publicPdfSupported, latestReport, runningChat, sidebarWidth, stageLabel, validateChatFiles, type ChatAttachment, type ChatConfig, type ChatDetail, type ChatEngine, type ChatSummary } from './researchChatModel';
import './ResearchChat.css';
import { ResearchQuestionCard } from './ResearchQuestionCard';
import { ChatRowStatus, ConversationMenu, ResearchToolsDialog } from './ResearchChatTools';
import { useResearchActivity } from './useResearchActivity';
import { useNotebookConfirm } from './NotebookTools';

type DraftFile = { key: string; file: File; url?: string; uploaded?: ChatAttachment };
type Outgoing = { cid: string; client_id: string; text: string; attachment_ids: string[] };

export function ResearchChat({ apiBase, language, userId, user, onClassic, onReportsChanged, seedTopic = '', onNavigate, appearance = 'system', onAppearanceChange, onLanguageChange, onLogout, visible = true, reportRunning = false }: {
  apiBase: string; language: Language; userId: string; user?: AuthUser; onClassic: () => void; onReportsChanged: () => void; seedTopic?: string; seedOptions?: ResearchOptions;
  onNavigate?: (view: AppView) => void; appearance?: Appearance; onAppearanceChange?: (value: Appearance) => void; onLanguageChange?: (value: Language) => void; onLogout?: () => void;
  visible?: boolean; reportRunning?: boolean;
}) {
  const vi = language === 'vi';
  const label = (a: string, b: string) => vi ? a : b;
  const [config, setConfig] = useState<ChatConfig | null>(null);
  const [list, setList] = useState<ChatSummary[]>([]);
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [engine, setEngine] = useState<ChatEngine>('nexora');
  const [model, setModel] = useState('');
  const [draft, setDraft] = useState(seedTopic);
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [tool, setTool] = useState<'search' | 'activity' | null>(null);
  const [rowMenu, setRowMenu] = useState<{ item: ChatSummary; anchor: HTMLElement } | null>(null);
  const [mutating, setMutating] = useState('');
  const [actionError, setActionError] = useState('');
  const [askDelete, deleteConfirmation] = useNotebookConfirm(language);
  const consentKey = 'nexora-muse-public-consent:v1:' + userId;
  const [ack, setAck] = useState(() => { try { return localStorage.getItem(consentKey) === 'accepted'; } catch { return false; } });
  const [consentVisible, setConsentVisible] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [editingTitle, setEditingTitle] = useState<ChatSummary | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(() => { try { return localStorage.getItem('nexora-research-sidebar') !== 'closed'; } catch { return true; } });
  const [width, setWidth] = useState(() => { try { return sidebarWidth(Number(localStorage.getItem('nexora-research-sidebar-width')) || 280); } catch { return 280; } });
  const [mobile, setMobile] = useState(() => matchMedia('(max-width:700px)').matches);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const root = useRef<HTMLElement>(null), drawer = useRef<HTMLElement>(null), chatMain = useRef<HTMLElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null), draftInput = useRef<HTMLTextAreaElement>(null), fileInput = useRef<HTMLInputElement>(null), imageDialog = useRef<HTMLDialogElement>(null), scroll = useRef<HTMLDivElement>(null);
  const titleDialog = useRef<HTMLDialogElement>(null);
  const selection = useRef<string | null>(null), retry = useRef<Outgoing | null>(null), fileRef = useRef<DraftFile[]>([]);
  const mounted = useRef(true), requestEpoch = useRef(0), listEpoch = useRef(0), detailEpoch = useRef(0), fileLock = useRef(false);
  const reportsChanged = useRef(onReportsChanged); reportsChanged.current = onReportsChanged;
  const lastAnnouncedReport = useRef('');
  const storageKey = 'nexora-research-chat:' + userId;
  const currentJob = detail?.jobs.find(runningChat);
  const busy = pending || loadingDetail || !!currentJob;
  const currentEngine = detail?.engine || engine;
  const currentModel = config?.opencode.models.find(item => item.id === (detail?.model || model));
  const usesDirect = ['direct_v1', 'direct_hil_v1'].includes(detail ? detail.runtime_transport || 'gateway' : currentModel?.transport || '');
  const gatewaySession = !!detail && (detail.runtime_transport || 'gateway') === 'gateway';
  const limits = config?.attachments || defaultAttachmentLimits;

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(apiBase + '/api/research/chats' + path, { credentials: 'include', cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
    const value = response.status === 204 ? {} : await response.json().catch(reason => { if (init?.signal?.aborted || (reason as Error).name === 'AbortError') throw reason; return {}; });
    if (init?.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (!response.ok) throw Object.assign(new Error(typeof value.detail === 'string' ? value.detail : 'request_failed'), { status: response.status });
    return value;
  }, [apiBase]);
  const clearFiles = useCallback((discard = false) => {
    const previous = fileRef.current; fileRef.current = [];
    previous.forEach(item => { if (item.url) URL.revokeObjectURL(item.url); if (discard && item.uploaded) void api('/attachments/' + item.uploaded.id, { method: 'DELETE' }).catch(() => {}); });
    setFiles([]);
  }, [api]);
  const refreshList = useCallback(async (signal?: AbortSignal) => {
    const epoch = ++listEpoch.current;
    const value = await api('?archived=false', { signal });
    if (!Array.isArray(value.conversations)) throw new Error('request_failed');
    if (mounted.current && epoch === listEpoch.current && !signal?.aborted) setList(value.conversations);
  }, [api]);
  const activity = useResearchActivity(api, userId, refreshList);
  const load = useCallback(async (id: string, signal?: AbortSignal) => {
    const epoch = ++detailEpoch.current;
    const value = await api('/' + encodeURIComponent(id), { signal }) as ChatDetail;
    if (!value.id || !Array.isArray(value.messages) || !Array.isArray(value.jobs)) throw new Error('request_failed');
    if (mounted.current && selection.current === id && epoch === detailEpoch.current && !signal?.aborted) setDetail(value);
    return value;
  }, [api]);
  useEffect(() => {
    mounted.current = true; let disposed = false;
    void api('/config').then((value: ChatConfig) => { if (!disposed) { setConfig(value); setModel(defaultOpenCodeModel(value.opencode.models)); } }).catch(() => { if (!disposed) setError('request_failed'); });
    let remembered: string | null = null; try { remembered = localStorage.getItem(storageKey); } catch { /* private browsing may deny storage */ }
    if (remembered) { selection.current = remembered; setLoadingDetail(true); void load(remembered).catch(() => { if (!disposed) { selection.current = null; try { localStorage.removeItem(storageKey); } catch { /* optional */ } } }).finally(() => { if (!disposed) setLoadingDetail(false); }); }
    return () => { disposed = true; mounted.current = false; requestEpoch.current++; listEpoch.current++; fileRef.current.forEach(item => { if (item.url) URL.revokeObjectURL(item.url); }); };
  }, [api, load, storageKey]);
  useEffect(() => { void refreshList().catch(() => { if (mounted.current) setError('request_failed'); }); }, [refreshList]);
  useEffect(() => {
    if (!currentJob || !detail) return;
    let disposed = false, timer: number, controller: AbortController; const cid = detail.id;
    const poll = async () => {
      controller = new AbortController(); const deadline = window.setTimeout(() => controller.abort(), 12000);
      try {
        const value = await load(cid, controller.signal);
        if (!disposed && !value.jobs.some(runningChat)) { const id = latestReport(value.jobs); if (id && id !== lastAnnouncedReport.current) { lastAnnouncedReport.current = id; reportsChanged.current(); } await refreshList(controller.signal); }
      } catch { if (!disposed) setError('connection_lost'); }
      finally { clearTimeout(deadline); if (!disposed) timer = window.setTimeout(() => void poll(), 1500); }
    };
    timer = window.setTimeout(() => void poll(), 1500);
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [currentJob?.id, detail?.id, load, refreshList]);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); }, [detail?.id, detail?.messages.length, detail?.questions?.length]);
  useEffect(() => { try { localStorage.setItem('nexora-research-sidebar', sidebarOpen ? 'open' : 'closed'); localStorage.setItem('nexora-research-sidebar-width', String(width)); } catch { /* layout is optional, no files stored */ } }, [sidebarOpen, width]);
  useEffect(() => {
    const media = matchMedia('(max-width:700px)'); const resize = () => { setMobile(media.matches); setMenuOpen(false); };
    media.addEventListener('change', resize);
    const viewport = () => { root.current?.style.setProperty('--chat-height', (window.visualViewport?.height || innerHeight) + 'px'); };
    viewport(); window.visualViewport?.addEventListener('resize', viewport);
    return () => { media.removeEventListener('change', resize); window.visualViewport?.removeEventListener('resize', viewport); };
  }, []);
  useEffect(() => {
    chatMain.current?.toggleAttribute('inert', mobile && menuOpen);
    if (!mobile || !menuOpen) return;
    const controls = () => Array.from(drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href]') || []).filter(el => el.getClientRects().length);
    controls()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      // A native child dialog owns focus and Escape while open. Do not close
      // the underlying mobile drawer or suppress the dialog's cancel event.
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); }
      if (event.key === 'Tab') { const elements = controls(), first = elements[0], last = elements[elements.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); chatMain.current?.removeAttribute('inert'); menuTrigger.current?.focus(); };
  }, [menuOpen, mobile]);
  useEffect(() => { if (preview && imageDialog.current && !imageDialog.current.open) imageDialog.current.showModal(); }, [preview]);
  useEffect(() => { if (editingTitle && !titleDialog.current?.open) titleDialog.current?.showModal(); }, [editingTitle]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!visible || event.repeat || document.querySelector('dialog[open]')) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); setMenuOpen(false); setTool('search'); }
      if (event.ctrlKey && event.altKey && event.code === 'KeyU') { event.preventDefault(); setMenuOpen(false); setTool('activity'); }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [visible]);
  useEffect(() => {
    // Reports is a child of this workspace. Hide transient overlays, but keep
    // the draft, local attachment previews and selected conversation in memory.
    if (!visible) {
      imageDialog.current?.close(); titleDialog.current?.close(); setEditingTitle(null); setTool(null); setRowMenu(null); setPreview(null); setMenuOpen(false);
      drawer.current?.querySelectorAll('details[open]').forEach(item => item.removeAttribute('open'));
    } else if (scroll.current) {
      requestAnimationFrame(() => scroll.current?.scrollTo({ top: scroll.current.scrollHeight }));
    }
  }, [visible]);

  const choose = async (item: ChatSummary) => {
    const epoch = ++requestEpoch.current; selection.current = item.id;
    try { localStorage.setItem(storageKey, item.id); } catch { /* optional */ }
    clearFiles(true); setPreview(null); setDetail(null); setError(''); setPending(false); setLoadingDetail(true); setEditingTitle(null); setDraft(''); retry.current = null;
    try { await load(item.id); } catch { if (epoch === requestEpoch.current) setError('request_failed'); }
    finally { if (epoch === requestEpoch.current) setLoadingDetail(false); }
  };
  const fresh = () => {
    setConsentVisible(false);
    requestEpoch.current++; selection.current = null; try { localStorage.removeItem(storageKey); } catch { /* optional */ }
    setModel(defaultOpenCodeModel(config?.opencode.models || []));
    clearFiles(true); setPreview(null); setDetail(null); setError(''); setDraft(''); setPending(false); setLoadingDetail(false); setEditingTitle(null); retry.current = null; setMenuOpen(false); draftInput.current?.focus();
  };
  const save = async (item: ChatSummary, fields: Record<string, unknown>) => {
    if (mutating) return; setMutating(item.id); setActionError('');
    try { await api('/' + item.id, { method: 'PATCH', body: JSON.stringify(fields) }); if (selection.current === item.id) await load(item.id); await refreshList(); titleDialog.current?.close(); setEditingTitle(null); }
    catch (reason) { setActionError((reason as Error).message); setError((reason as Error).message); }
    finally { if (mounted.current) setMutating(''); }
  };
  const archive = async (item: ChatSummary) => {
    const accepted = await askDelete(label(`Xóa vĩnh viễn “${item.title}”, lịch sử và tệp chỉ thuộc phiên này? Không thể khôi phục. Báo cáo đã lưu trong thư viện vẫn được giữ.`, `Permanently delete “${item.title}”, its history and files used only by this session? This cannot be undone. Saved library reports are kept.`), { title: label('Lưu trữ và xóa cuộc trò chuyện?', 'Archive and delete conversation?'), confirmLabel: label('Xóa vĩnh viễn', 'Delete permanently'), destructive: true });
    if (!accepted || !mounted.current || mutating) return;
    setMutating(item.id);
    try { await api('/' + item.id, { method: 'DELETE' }); if (selection.current === item.id) fresh(); await refreshList(); }
    catch (reason) { if (mounted.current) setError((reason as Error).message); }
    finally { if (mounted.current) setMutating(''); }
  };
  const addFiles = (incoming: File[]) => {
    if (busy || retry.current || detail?.archived) return;
    const additions = incoming.filter(file => !fileRef.current.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified));
    const combined = [...fileRef.current.map(item => item.file), ...additions];
    const code = validateChatFiles(combined, limits);
    if (code) { setError(code); return; }
    const next = [...fileRef.current, ...additions.map(file => ({ key: crypto.randomUUID(), file, url: isImageFile(file) ? URL.createObjectURL(file) : undefined }))];
    fileRef.current = next; setFiles(next); setError('');
  };
  const removeFile = (item: DraftFile) => {
    if (busy || retry.current) return;
    if (item.url) URL.revokeObjectURL(item.url);
    if (item.uploaded) void api('/attachments/' + item.uploaded.id, { method: 'DELETE' }).catch(() => {});
    const next = fileRef.current.filter(file => file.key !== item.key); fileRef.current = next; setFiles(next); setError(''); draftInput.current?.focus();
  };
  const changedModel = detail?.model === 'nexora-configured' && !!detail.model_label && !!currentModel && detail.model_label !== currentModel.name;
  const transportReady = usesDirect ? !!config?.opencode.direct_enabled : (config?.opencode.gateway_ready ?? config?.opencode.ready);
  const modelReady = gatewaySession ? (currentModel?.gateway_ready ?? currentModel?.ready) : currentModel?.ready;
  const selectedReady = !!transportReady && !!currentModel && modelReady !== false && !changedModel;
  const connectionCode = changedModel ? 'opencode_configured_model_changed' : usesDirect && !config?.opencode.direct_enabled ? 'opencode_direct_disabled' : !transportReady ? (config?.opencode.gateway_code || config?.opencode.code) : !currentModel ? 'opencode_model_not_allowed' : modelReady === false ? (gatewaySession ? currentModel.gateway_code || currentModel.code : currentModel.code) : config?.opencode.code;
  const pdfSupported = publicPdfSupported(currentModel, detail ? detail.runtime_transport : currentModel?.transport);
  const pdfOnly = files.length > 0 && files.every(item => isPdfFile(item.file));
  const privateBlocked = files.length > 0 && currentEngine === 'opencode' && !currentModel?.private_allowed && !(pdfSupported && pdfOnly);
  const imageBlocked = files.some(item => isImageFile(item.file)) && !(currentEngine === 'opencode' ? currentModel?.image_inputs : config?.nexora?.image_inputs);
  const externalReady = selectedReady && !!model && ack;
  const canSend = !!config && !busy && !detail?.archived && !privateBlocked && !imageBlocked && (detail ? detail.engine === 'nexora' || selectedReady : engine === 'nexora' || externalReady);
  const send = async (checkSameRequest = false) => {
    if (fileLock.current || busy || !canSend || (!checkSameRequest && retry.current) || (!draft.trim() && !fileRef.current.length && !checkSameRequest)) return;
    fileLock.current = true; const epoch = requestEpoch.current;
    setPending(true); setError('');
    try {
      let cid = detail?.id || selection.current || (checkSameRequest ? retry.current?.cid : undefined);
      if (!cid) {
        const created = await api('', { method: 'POST', body: JSON.stringify({ engine, model, external_data_ack: ack, settings: { report_language: 'auto', preferred_report_language: language, analysis_mode: 'research' } }) });
        cid = created.id as string;
        if (epoch !== requestEpoch.current) return;
        selection.current = cid; try { localStorage.setItem(storageKey, cid); } catch { /* optional */ }
        await load(cid);
      }
      if (!mounted.current || epoch !== requestEpoch.current) return;
      let outgoing = checkSameRequest && retry.current?.cid === cid ? retry.current : null;
      if (!outgoing) {
        const ids: string[] = [];
        for (const item of fileRef.current) {
          if (!mounted.current || epoch !== requestEpoch.current) return;
          if (!item.uploaded) {
            const response = await fetch(apiBase + '/api/research/chats/attachments', { method: 'POST', credentials: 'include', headers: { 'Content-Type': item.file.type || 'application/octet-stream', 'X-Attachment-Name': encodeURIComponent(item.file.name) }, body: item.file });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'request_failed');
            item.uploaded = result as ChatAttachment;
            if (epoch !== requestEpoch.current) { void api('/attachments/' + item.uploaded.id, { method: 'DELETE' }).catch(() => {}); return; }
            setFiles([...fileRef.current]);
          }
          ids.push(item.uploaded.id);
        }
        outgoing = { cid, client_id: crypto.randomUUID(), text: draft, attachment_ids: ids };
      }
      retry.current = outgoing;
      const sentJob = await api('/' + cid + '/messages', { method: 'POST', body: JSON.stringify({ client_id: outgoing.client_id, text: outgoing.text, action: 'chat', attachment_ids: outgoing.attachment_ids }) });
      activity.observe([sentJob]);
      if (epoch !== requestEpoch.current) return;
      retry.current = null; setDraft(''); clearFiles(); await load(cid); await refreshList();
    } catch (reason) { if (epoch === requestEpoch.current) { if ((reason as { status?: number }).status && (reason as { status: number }).status < 500) retry.current = null; setError((reason as Error).message); } }
    finally { fileLock.current = false; if (mounted.current && epoch === requestEpoch.current) setPending(false); }
  };
  const selectEngine = (value: ChatEngine) => { setEngine(value); setError(''); };
  const acknowledge = (value: boolean) => {
    setConsentVisible(true);
    setAck(value); try { if (value) localStorage.setItem(consentKey, 'accepted'); else localStorage.removeItem(consentKey); } catch { /* optional, never stores content or keys */ }
  };
  const answer = async (qid: string, answers: string[][], reject: boolean) => {
    if (!detail) return;
    const cid = detail.id, epoch = requestEpoch.current;
    try {
      await api('/' + cid + '/questions/' + qid + '/answer', { method: 'POST', body: JSON.stringify({ answers, reject }) });
      if (epoch === requestEpoch.current) { setError(''); await load(cid); }
    } catch (reason) { if (epoch === requestEpoch.current) setError((reason as Error).message); }
  };
  const contentUrl = (id: string) => apiBase + '/api/research/chats/attachments/' + encodeURIComponent(id) + '/content';
  const attachmentCard = (item: ChatAttachment) => <div className="research-chat__file" key={item.id}>
    {item.kind === 'image' ? <button type="button" className="research-chat__thumbnail" aria-label={label('Xem ảnh ', 'Preview image ') + item.name} onClick={() => setPreview({ url: contentUrl(item.id), name: item.name })}><img src={contentUrl(item.id)} alt="" /></button> : <FileText size={23} />}
    <div><strong title={item.name}>{item.name}</strong><small>{fileSize(item.size)}{item.kind === 'document' ? label(' · Trích đoạn', ' · Text excerpts') : ''}{item.warning ? label(' · Giới hạn nội dung', ' · Content limited') : ''}</small></div>
    <a href={contentUrl(item.id)} download={item.name} aria-label={label('Tải tệp ', 'Download ') + item.name}><Upload size={15} className="research-chat__download" /></a>
  </div>;
  const sessionJob = (item: ChatSummary) => activity.activities.find(job => job.conversation_id === item.id && runningChat(job)) || (detail?.id === item.id ? currentJob : undefined) || activity.activities.find(job => job.conversation_id === item.id) || item.latest_job;
  const openTools = (mode: 'search' | 'activity') => { setMenuOpen(false); setTool(mode); };
  const fileProblem = privateBlocked ? pdfSupported ? 'opencode_pdf_only' : 'opencode_public_sources_only' : imageBlocked ? 'attachment_image_not_supported' : '';
  const lastJob = detail?.jobs[0], failedJob = lastJob && ['failed', 'interrupted', 'cancelled'].includes(lastJob.status) ? lastJob : undefined;
  const attachmentProblem = error || fileProblem || failedJob?.error_code;
  return <main ref={root} className={'research-chat' + (!sidebarOpen ? ' is-collapsed' : '')} style={{ '--chat-sidebar-width': width + 'px' } as CSSProperties}>
    {mobile && menuOpen && <button type="button" className="research-chat__backdrop" tabIndex={-1} aria-label={label('Đóng khung lịch sử', 'Close history panel')} onClick={() => setMenuOpen(false)} />}
    <aside id="research-chat-sidebar" ref={drawer} role={mobile && menuOpen ? 'dialog' : undefined} aria-modal={mobile && menuOpen || undefined} className={'research-chat__sidebar' + (menuOpen ? ' is-open' : '')} aria-label={label('Lịch sử nghiên cứu', 'Research history')}>
      <div className="research-chat__brand"><button type="button" onClick={() => onNavigate?.('overview')} aria-label={label('Về tổng quan Nexora', 'Nexora overview')}><BrandMark size={32} /></button><span className="research-chat__wide"><strong>Nexora</strong><small>{label('Nghiên cứu', 'Research')}</small></span><button type="button" className="research-chat__mobile-close" onClick={() => setMenuOpen(false)} aria-label={label('Đóng lịch sử', 'Close history')}><X size={18} /></button></div>
      <div className="research-chat__utilities"><button type="button" onClick={() => openTools('activity')} aria-label={label('Xem hoạt động', 'View activity')} title={label('Xem hoạt động · Ctrl+Alt+U', 'View activity · Ctrl+Alt+U')}><Bell size={18} />{activity.activities.filter(runningChat).length > 0 && <span className="research-chat__activity-badge">{activity.activities.filter(runningChat).length}</span>}</button><button type="button" onClick={() => openTools('search')} aria-label={label('Tìm kiếm', 'Search')} title={label('Tìm kiếm · Ctrl+K', 'Search · Ctrl+K')}><Search size={18} /><span className="research-chat__wide">{label('Tìm kiếm', 'Search')}</span><kbd className="research-chat__wide">Ctrl K</kbd></button></div>
      <button type="button" className="research-chat__exit" onClick={() => onNavigate?.('overview')} aria-label={label('Về Nexora', 'Back to Nexora')} title={label('Về Nexora', 'Back to Nexora')}><ArrowLeft size={17} /><span className="research-chat__wide">{label('Về Nexora', 'Back to Nexora')}</span></button>
      <button type="button" className="research-chat__new" onClick={fresh} aria-label={label('Cuộc trò chuyện mới', 'New conversation')} title={label('Cuộc trò chuyện mới', 'New conversation')}><Plus size={18} /><span className="research-chat__wide">{label('Cuộc trò chuyện mới', 'New conversation')}</span></button>
      <nav aria-label={label('Cuộc trò chuyện', 'Conversations')}>{[true, false].map(pinned => <section key={String(pinned)} className="research-chat__history-group" aria-label={pinned ? label('Đã ghim', 'Pinned') : label('Cuộc trò chuyện gần đây', 'Recent chats')}><h2 className="research-chat__wide">{pinned ? <><Pin size={12} />{label('Đã ghim', 'Pinned')}</> : label('Cuộc trò chuyện', 'Chats')}<span>{list.filter(item => item.pinned === pinned).length}</span></h2>{list.filter(item => item.pinned === pinned).map(item => <div key={item.id} className={'research-chat__history-row' + (selection.current === item.id ? ' is-selected' : '')}>
        <button type="button" aria-label={item.title} title={item.title} className="research-chat__history" onClick={() => { void choose(item); setMenuOpen(false); }}><span><MessageSquare size={15} /><strong className="research-chat__wide">{item.title}</strong></span><small className="research-chat__wide">{chatModeLabel(item.engine)}</small></button><span className="research-chat__row-status"><ChatRowStatus job={sessionJob(item)} vi={vi} /></span><button type="button" className="research-chat__row-options research-chat__wide" disabled={mutating === item.id} aria-label={label('Tùy chọn: ', 'Options: ') + item.title} title={label('Tùy chọn cuộc trò chuyện', 'Conversation options')} onClick={event => setRowMenu({ item, anchor: event.currentTarget })}><MoreVertical size={17} /></button>
      </div>)}{!list.some(item => item.pinned === pinned) && <p className="research-chat__empty-group research-chat__wide">{pinned ? label('Ghim để truy cập nhanh', 'Pin chats for quick access') : label('Chưa có cuộc trò chuyện', 'No conversations yet')}</p>}</section>)}</nav>
      <div className="research-chat__side-bottom">
        <button type="button" className="research-chat__classic" onClick={onClassic} aria-label={label('Báo cáo · công cụ hiện tại', 'Reports · classic workspace')} title={label('Báo cáo · công cụ hiện tại', 'Reports · classic workspace')}><NotebookText size={18} /><span className="research-chat__wide">{label('Báo cáo', 'Reports')}<small className={reportRunning ? 'research-chat__report-running' : ''}>{reportRunning ? label('Phiên nghiên cứu đang chạy', 'Research session running') : label('Trong không gian Research', 'Within Research')}</small></span></button>
        <details className="research-chat__nav-menu"><summary aria-label={label('Không gian Nexora', 'Nexora workspace')} title={label('Không gian Nexora', 'Nexora workspace')}><LayoutGrid size={18} /><span className="research-chat__wide">{label('Không gian Nexora', 'Nexora workspace')}</span></summary><div>{([{ view: 'overview', icon: LayoutGrid, text: label('Tổng quan', 'Overview') }, { view: 'domains', icon: Globe2, text: label('Lĩnh vực', 'Fields') }, { view: 'reports', icon: Library, text: label('Thư viện', 'Library') }, { view: 'collab', icon: Folder, text: label('Dự án', 'Projects') }] as const).map(item => <button type="button" key={item.view} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onNavigate?.(item.view); }}><item.icon size={17} />{item.text}</button>)}</div></details>
        <details className="research-chat__account"><summary aria-label={label('Tài khoản và giao diện', 'Account and appearance')}><span className="research-chat__avatar">{(user ? displayName(user) : 'Nexora').slice(0, 1)}</span><strong className="research-chat__wide">{user ? displayName(user) : 'Nexora'}</strong><ChevronDown size={14} className="research-chat__wide" /></summary><div><button type="button" onClick={() => onNavigate?.('profile')}>{label('Hồ sơ và tài khoản', 'Profile and account')}</button><label>{label('Giao diện', 'Appearance')}<select value={appearance} onChange={event => onAppearanceChange?.(event.target.value as Appearance)}><option value="system">{label('Theo hệ thống', 'System')}</option><option value="light">{label('Sáng', 'Light')}</option><option value="dark">{label('Tối', 'Dark')}</option></select></label><label>{label('Ngôn ngữ', 'Language')}<select value={language} onChange={event => onLanguageChange?.(event.target.value as Language)}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>{onLogout && <button type="button" onClick={onLogout}><LogOut size={16} />{label('Đăng xuất', 'Sign out')}</button>}</div></details>
      </div>
      <button type="button" className="research-chat__resize" aria-label={label('Đổi độ rộng thanh bên', 'Resize sidebar')} disabled={!sidebarOpen} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(sidebarWidth(event.clientX - (root.current?.getBoundingClientRect().left || 0))); }} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setWidth(value => sidebarWidth(value + (event.key === 'ArrowRight' ? 10 : -10))); } }} />
    </aside>
    <section ref={chatMain} className="research-chat__main">
      <header className="research-chat__header"><button type="button" className="research-chat__mobile-exit" onClick={() => onNavigate?.('overview')} aria-label={label('Về Nexora', 'Back to Nexora')} title={label('Về Nexora', 'Back to Nexora')}><ArrowLeft size={18} /></button><button ref={menuTrigger} type="button" className="research-chat__sidebar-toggle" onClick={() => mobile ? setMenuOpen(!menuOpen) : setSidebarOpen(!sidebarOpen)} aria-controls="research-chat-sidebar" aria-expanded={mobile ? menuOpen : sidebarOpen} aria-label={label(mobile || !sidebarOpen ? 'Mở lịch sử' : 'Thu thanh bên', mobile || !sidebarOpen ? 'Open history' : 'Collapse sidebar')}><PanelLeft size={19} /></button><div><strong>{detail?.title || label('Cuộc trò chuyện mới', 'New conversation')}</strong>{detail && <small>{chatModeLabel(detail.engine)}</small>}</div>
      </header>
      <div ref={scroll} className="research-chat__scroll">
        {loadingDetail && <p role="status"><LoaderCircle size={18} />{label('Đang tải lịch sử…', 'Loading history…')}</p>}
        {!detail && !loadingDetail && <div className="research-chat__setup"><span className="research-chat__hero-mark"><Sparkles size={25} /></span><h1>{label('Bạn muốn tìm hiểu điều gì?', 'What would you like to explore?')}</h1><p>{label('Hỏi một câu, gửi tài liệu hoặc đưa ảnh vào cuộc trò chuyện.', 'Ask a question, share a document or add an image to the conversation.')}</p><div className="research-chat__suggestions"><button type="button" onClick={() => { setDraft(label('Giải thích cách MediaPipe Hand Landmarker xử lý video.', 'Explain how MediaPipe Hand Landmarker processes video.')); draftInput.current?.focus(); }}>{label('Giải thích một cơ chế', 'Explain a mechanism')}</button><button type="button" onClick={() => fileInput.current?.click()}><Paperclip size={16} />{label('Thêm tệp hoặc ảnh', 'Add files or images')}</button></div></div>}
        {detail && <><p className="research-chat__scope">{label('Chat là trao đổi sơ bộ, không phải báo cáo đã kiểm chứng.', 'Chat is preliminary discussion, not a verified report.')}</p><div className="research-chat__messages">{detail.messages.map(message => <article key={message.id} className={'research-chat__message is-' + message.role}><small>{message.role === 'user' ? label('Bạn', 'You') : chatModeLabel(detail.engine)}</small><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span>{alt || label('Ảnh bên ngoài không tự tải.', 'External images are not loaded automatically.')}</span> }}>{message.body}</ReactMarkdown>{!!message.attachments?.length && <div className="research-chat__sent-files">{message.attachments.map(attachmentCard)}</div>}{message.role === 'assistant' && detail.jobs.some(job => job.id === message.job_id && job.report_id) && <button type="button" onClick={() => onNavigate ? onNavigate('reports') : onClassic()}><Library size={16} />{label('Xem trong thư viện báo cáo', 'View in report library')}</button>}</article>)}</div></>}
        {detail?.questions?.filter(item => item.state === 'pending' || item.job_id === currentJob?.id || item.job_id === failedJob?.id).map(item => <ResearchQuestionCard key={item.id} question={item} vi={vi} onAnswer={(answers, reject) => answer(item.id, answers, reject)} />)}
      </div>
      {currentEngine === 'opencode' && !detail && (!ack || consentVisible) && <div className="research-chat__consent-note"><span>{label('Muse Spark Free có thể dùng tin nhắn và câu trả lời để huấn luyện model. Chỉ gửi nội dung công khai, không gửi thông tin cá nhân hoặc bí mật.', 'Muse Spark Free may use prompts and answers for model training. Share public content only, never personal or confidential information.')}</span><label className="research-chat__consent"><input type="checkbox" checked={ack} onChange={event => acknowledge(event.target.checked)} />{label('Tôi hiểu và đồng ý điều kiện dữ liệu này.', 'I understand and agree to these data terms.')}</label></div>}
      {currentEngine === 'opencode' && !selectedReady && <div className="research-chat__error" role="status">{errorLabel(connectionCode || 'opencode_not_configured', vi)}<button type="button" disabled={pending} onClick={() => void api('/config').then(setConfig).catch(() => setError('request_failed'))}>{label('Kiểm tra lại kết nối', 'Check connection again')}</button></div>}
      {currentEngine === 'opencode' && !!detail && !usesDirect && config?.opencode.direct_enabled && ['direct_v1','direct_hil_v1'].includes(currentModel?.transport || '') && <p className="research-chat__transport">{label('Phiên này giữ đường kết nối cũ. Tạo cuộc trò chuyện mới để thử OpenCode trực tiếp.', 'This session retains its original connection. Start a new conversation to try direct OpenCode.')}</p>}
      {attachmentProblem && <div role="alert" className="research-chat__error">{errorLabel(attachmentProblem, vi)}{error && retry.current && <button type="button" disabled={busy} onClick={() => void send(true)}>{label('Kiểm tra lại lượt gửi này', 'Check this same request again')}</button>}</div>}
      <form className={'research-chat__composer' + (dragging ? ' is-dragging' : '')} onSubmit={event => { event.preventDefault(); void send(); }} onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}>
        {currentJob && <div className="research-chat__progress" role="status"><LoaderCircle size={16} className={currentJob.status === 'awaiting_input' ? '' : 'spin'} />{stageLabel(currentJob.action === 'report' || ['awaiting_input','resuming'].includes(currentJob.stage) ? currentJob.stage : 'replying', vi)}<button type="button" onClick={() => void api('/' + detail!.id + '/stop', { method: 'POST' }).then(() => load(detail!.id)).catch(() => setError('request_failed'))}><Square size={13} />{label('Dừng', 'Stop')}</button></div>}
        {pending && <div className="research-chat__progress" role="status"><LoaderCircle size={16} className="spin" />{files.length ? label('Đang tải tệp và gửi tin…', 'Uploading files and sending…') : label('Đang gửi…', 'Sending…')}</div>}
        {!!files.length && <div className="research-chat__attachments" aria-label={label('Tệp đính kèm trước khi gửi', 'Draft attachments')}>{files.map(item => <div className="research-chat__file" key={item.key}>{item.url ? <button type="button" className="research-chat__thumbnail" aria-label={label('Xem ảnh ', 'Preview image ') + item.file.name} onClick={() => setPreview({ url: item.url!, name: item.file.name })}><img src={item.url} alt="" /></button> : <FileText size={23} />}<div><strong title={item.file.name}>{item.file.name}</strong><small>{fileSize(item.file.size)}{item.uploaded?.warning ? label(' · Đọc một phần', ' · Partially read') : ''}</small></div><button type="button" className="research-chat__remove" disabled={busy || !!retry.current} aria-label={label('Gỡ ', 'Remove ') + item.file.name} onClick={() => removeFile(item)}><X size={15} /></button></div>)}</div>}
        <input ref={fileInput} type="file" multiple hidden accept={limits.extensions.join(',')} onChange={event => { addFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
        <textarea ref={draftInput} aria-label={label('Tin nhắn nghiên cứu', 'Research message')} placeholder={label('Hỏi một câu, hoặc kéo tệp / ảnh vào đây…', 'Ask a question, or drop files / images here…')} value={draft} disabled={busy || !!retry.current || !!detail?.archived} onChange={event => setDraft(event.target.value)} onPaste={event => { const images = Array.from(event.clipboardData.items).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((item): item is File => !!item); if (images.length) { event.preventDefault(); addFiles(images); } }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        <div className="research-chat__composer-actions"><button type="button" disabled={busy || !!retry.current || !!detail?.archived} onClick={() => fileInput.current?.click()} aria-label={label('Đính kèm tệp và ảnh', 'Attach files and images')} title={label('Đính kèm tệp và ảnh', 'Attach files and images')}><Paperclip size={20} /></button><select aria-label={label('Chế độ chat', 'Chat engine')} value={currentEngine} disabled={!!detail || busy} onChange={event => selectEngine(event.target.value as ChatEngine)}><option value="nexora">{chatModeLabel('nexora')}</option><option value="opencode">{chatModeLabel('opencode')}</option></select><span /><button type="submit" disabled={!canSend || !!retry.current || (!draft.trim() && !files.length)} aria-label={label('Gửi', 'Send')}><Send size={18} /></button></div>
        {dragging && <div className="research-chat__drop-hint"><Upload size={23} />{label('Thả tệp hoặc ảnh để đính kèm', 'Drop files or images to attach')}</div>}
      </form>
      <div className="research-chat__composer-note">{files.length ? label('Tối đa 5 tệp · 10 MB/tệp · tổng 20 MB. Chỉ tải lên khi bạn gửi.', 'Up to 5 files · 10 MB/file · 20 MB total. Uploaded only when you send.') : label('Enter gửi · Shift+Enter xuống dòng. Báo cáo dùng công cụ riêng bên trái.', 'Enter sends · Shift+Enter for newline. Reports use the separate tool in the sidebar.')}</div>
    </section>
    {rowMenu && <ConversationMenu item={rowMenu.item} anchor={rowMenu.anchor} vi={vi} active={runningChat(sessionJob(rowMenu.item) || undefined) || (!!pending && selection.current === rowMenu.item.id)} onClose={() => setRowMenu(null)} onRename={() => { setActionError(''); setTitleDraft(rowMenu.item.title); setEditingTitle(rowMenu.item); }} onPin={() => void save(rowMenu.item, { pinned: !rowMenu.item.pinned })} onArchive={() => void archive(rowMenu.item)} />}
    {tool && <ResearchToolsDialog mode={tool} vi={vi} api={api} activities={activity.activities} connectionLost={activity.connectionLost} sound={activity.sound} onSound={activity.setSound} onOpen={item => { void choose(item); setMenuOpen(false); }} onClose={() => setTool(null)} />}
    {deleteConfirmation}
    <dialog ref={titleDialog} className="research-chat__tools-dialog research-chat__rename-dialog" aria-labelledby="research-rename-title" onCancel={event => { if (mutating) event.preventDefault(); else setEditingTitle(null); }}><form onSubmit={event => { event.preventDefault(); if (editingTitle && titleDraft.trim()) void save(editingTitle, { title: titleDraft.trim() }); }}><header><h2 id="research-rename-title">{label('Đổi tên cuộc trò chuyện', 'Rename conversation')}</h2></header><input autoFocus disabled={!!mutating} maxLength={120} aria-label={label('Tên cuộc trò chuyện', 'Conversation title')} value={titleDraft} onChange={event => setTitleDraft(event.target.value)} />{actionError && <p role="alert">{errorLabel(actionError, vi)}</p>}<footer><button type="button" disabled={!!mutating} onClick={() => { titleDialog.current?.close(); setEditingTitle(null); }}>{label('Hủy', 'Cancel')}</button><button type="submit" disabled={!!mutating || !titleDraft.trim()}>{label('Lưu', 'Save')}</button></footer></form></dialog>
    <dialog ref={imageDialog} className="research-chat__image-dialog" aria-label={label('Xem ảnh đính kèm', 'Attachment image preview')} onClose={() => setPreview(null)} onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.currentTarget.close(); } }}><header><strong>{preview?.name}</strong><button type="button" onClick={() => imageDialog.current?.close()} aria-label={label('Đóng ảnh', 'Close image')}><X size={20} /></button></header>{preview && <img src={preview.url} alt={preview.name} />}</dialog>
  </main>;
}
