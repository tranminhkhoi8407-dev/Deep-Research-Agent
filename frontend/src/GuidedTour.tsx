import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { consumeFieldTour, handoffParameter, stageFieldTour, withoutTourHandoff } from './tourHandoff';
import { ArrowLeft, ArrowRight, BookOpenCheck, Check, Compass, HelpCircle, Pause, Play, RotateCcw, ShieldCheck, X } from 'lucide-react';
import type { AuthUser } from './Auth';
import type { AppView, Language } from './ProductViews';
import { fieldRoute } from './fieldNavigation';
import './GuidedTour.css';

export type TourId = 'core' | 'research' | 'fields' | 'library' | 'host';
export type TourRequest = TourId | 'catalog' | null;
type TourStatus = 'dismissed' | 'in_progress' | 'completed';
type Copy = { vi: string; en: string };
type TourStep = {
  view: AppView;
  target: string;
  title: Copy;
  body: Copy;
  clickToAdvance?: boolean;
};
type TourDefinition = { name: Copy; summary: Copy; steps: TourStep[] };
type TourProgress = { tour_id: TourId; version: number; step_index: number; status: TourStatus; updated_at: string };
type ActiveTour = { id: TourId; index: number };
type Box = { top: number; left: number; right: number; bottom: number; width: number; height: number };

const c = (vi: string, en: string): Copy => ({ vi, en });
const TOUR_VERSION = 1;

const tours: Record<TourId, TourDefinition> = {
  core: {
    name: c('Khám phá Nexora', 'Explore Nexora'),
    summary: c('Lộ trình ngắn từ câu hỏi đến báo cáo có nguồn.', 'A short path from question to sourced report.'),
    steps: [
      { view: 'overview', target: 'overview-hero', title: c('Trung tâm nghiên cứu của bạn', 'Your research command center'), body: c('Tổng quan cho thấy báo cáo, nguồn và phiên chuyên sâu. Bắt đầu brief mới ở đây hoặc đi theo từng mục trên thanh điều hướng.', 'Overview brings together reports, sources, and deep sessions. Start a brief here or explore the workspace navigation.') },
      { view: 'overview', target: 'nav-research', title: c('Mở không gian Nghiên cứu', 'Open the Research workspace'), body: c('Bấm mục Nghiên cứu đang được làm nổi bật, hoặc dùng nút bên dưới, để xem nơi tạo brief.', 'Select the highlighted Research tab, or use the button below, to see where a brief begins.'), clickToAdvance: true },
      { view: 'research', target: 'research-topic', title: c('Đặt câu hỏi có phạm vi', 'Write a focused question'), body: c('Một brief tốt nêu rõ đối tượng, thời gian và điều cần so sánh. Bạn có thể thử nhập nháp; tour sẽ không chạy nghiên cứu hay gửi nội dung đi.', 'A good brief names the subject, timeframe, and comparison criteria. You can type a draft; the tour will not run research or submit it.') },
      { view: 'research', target: 'research-depth', title: c('Chọn độ sâu phù hợp', 'Choose the right depth'), body: c('Nhanh để thử ý tưởng, Tiêu chuẩn cho báo cáo cân bằng, Chuyên sâu khi cần kiểm chứng nhiều vòng. Mức sâu hơn có thể dùng thêm quota API.', 'Use Quick to explore, Standard for a balanced report, or Deep for more rounds of verification. Deeper work can use more API quota.') },
      { view: 'domains', target: 'field-picker', title: c('Nghiên cứu theo lĩnh vực', 'Research by discipline'), body: c('Toán, Lý, Hóa, Sinh và AI có category, playbook và nguồn ưu tiên riêng. Bạn có thể chọn một lĩnh vực mà không làm thay đổi dữ liệu báo cáo.', 'Math, Physics, Chemistry, Biology, and AI each have their own categories, playbooks, and source lanes.') },
      { view: 'reports', target: 'library-fields', title: c('Thư viện học thuật', 'The academic library'), body: c('Chọn lĩnh vực để khám phá metadata paper, tạp chí và công cụ lưu bài. Báo cáo riêng của bạn nằm trong nhánh “My reports”.', 'Choose a field to discover paper metadata, journals, and saved reading. Your own reports live under My reports.') },
      { view: 'sources', target: 'source-catalog', title: c('Theo dõi bằng chứng', 'Trace the evidence'), body: c('Kho nguồn gom các nguồn thực sự được dùng trong báo cáo. Bộ lọc chất lượng giúp bạn rà lại xuất xứ trước khi tin vào kết luận.', 'The source catalog groups evidence actually used in reports. Quality filters help you check provenance before relying on conclusions.') },
      { view: 'profile', target: 'profile-hero', title: c('Đây là hành trình của bạn', 'Make this workspace yours'), body: c('Hồ sơ cho thấy hoạt động, lĩnh vực quan tâm và tiến độ Guide. Mở lại tour bất cứ lúc nào từ avatar hoặc Guide.', 'Your profile shows activity, research interests, and Guide progress. Reopen any tour from the avatar or Guide at any time.') },
    ],
  },
  research: {
    name: c('Tạo nghiên cứu đầu tiên', 'Your first research'),
    summary: c('Hiểu brief, độ sâu, analyst và điểm bắt đầu an toàn.', 'Understand the brief, depth, analysts, and safe launch point.'),
    steps: [
      { view: 'research', target: 'research-topic', title: c('Viết brief cụ thể', 'Write a specific brief'), body: c('Nêu vấn đề, phạm vi, đối tượng và tiêu chí đánh giá. Bạn có thể dùng gợi ý hoặc nhập câu hỏi của riêng mình.', 'State the problem, scope, audience, and evaluation criteria. Try a suggestion or write your own question.') },
      { view: 'research', target: 'research-depth', title: c('Cân đối độ sâu và quota', 'Balance depth and quota'), body: c('Chế độ Nhanh ít vòng hơn; Tiêu chuẩn là điểm bắt đầu tốt; Chuyên sâu kiểm tra nhiều góc nhìn hơn.', 'Quick uses fewer rounds; Standard is a good starting point; Deep explores more perspectives.') },
      { view: 'research', target: 'research-options', title: c('Analyst và tự động duyệt', 'Analysts and auto-approval'), body: c('Nhiều analyst tạo thêm góc nhìn. Tắt tự động duyệt nếu bạn muốn phản hồi ở các mốc dừng của pipeline.', 'More analysts add perspectives. Turn off auto-approval when you want to review the pipeline at its pause points.') },
      { view: 'research', target: 'research-launch', title: c('Bạn quyết định khi nào chạy', 'You decide when to run it'), body: c('Nút này mới khởi chạy pipeline và có thể tiêu thụ quota. Tour chỉ giới thiệu vị trí, sẽ không tự bấm hay gửi brief.', 'This button starts the pipeline and may consume API quota. The tour only points it out; it never presses it for you.') },
    ],
  },
  fields: {
    name: c('Không gian nghiên cứu theo lĩnh vực', 'Field research workspaces'),
    summary: c('Tạo cây trang, viết theo khối và tổ chức nghiên cứu.', 'Build a page tree, write in blocks, and organize research.'),
    steps: [
      { view: 'domains', target: 'field-picker', title: c('Mở không gian của bạn', 'Open your own workspace'), body: c('Chọn một thẻ để chuyển sang trang editor ngay trong tab hiện tại. Tour sẽ tiếp tục khi workspace sẵn sàng. Lần đầu mở sẽ tạo notebook riêng cho lĩnh vực đó.', 'Choose a card to navigate to the editor in this tab. The tour continues when your workspace is ready. Your first visit creates a personal field notebook.'), clickToAdvance: true },
      { view: 'domains', target: 'field-tree', title: c('Cây trang nhiều cấp', 'A tree of ideas'), body: c('Dấu + tạo trang con. Kéo một trang vào trang khác để lồng cấp, hoặc dùng “Chuyển vào trang” trong menu trang. Trang lưu trữ có thể khôi phục.', 'Use + to create subpages. Drag a page onto another to nest it, or choose Move into page from the page menu. Archived branches can be restored.') },
      { view: 'domains', target: 'field-writing', title: c('Không gian viết theo khối', 'Your block-based writing space'), body: c('Gõ / hoặc bấm + cạnh dòng để thêm khối; bấm ⋮⋮ để đổi loại, màu hay nhân bản. Gõ $$công thức$$ để tạo công thức trong dòng, hoặc /math để thêm Block equation ở giữa trang. Chờ “Đã đồng bộ” trước khi đóng.', 'Type / or use + beside a line to add blocks; use ⋮⋮ to turn into another type, color, or duplicate. Type $$formula$$ for inline math, or /math for a centered Block equation. Wait for All changes synced before closing.') },
      { view: 'domains', target: 'field-guide', title: c('Tra cứu editor & công thức', 'Editor & formula reference'), body: c('Mở hướng dẫn ở sidebar để xem thao tác viết khối và 65 mẫu LaTeX: 15 cú pháp cơ bản, mỗi lĩnh vực 10 mẫu. Bạn có thể xem trước và sao chép mã để dùng trong trang.', 'Open the sidebar guide for block editing and 65 LaTeX examples: 15 basics and 10 per field. Preview and copy the source into your page.') },
    ],
  },
  library: {
    name: c('Khám phá thư viện paper', 'Explore the paper library'),
    summary: c('Từ lựa chọn lĩnh vực đến tìm kiếm và đọc metadata.', 'From a discipline to search and paper metadata.'),
    steps: [
      { view: 'reports', target: 'library-hero', title: c('Bắt đầu theo lĩnh vực', 'Start with a discipline'), body: c('Thư viện tách khám phá học thuật khỏi báo cáo do bạn tạo, để việc tìm đọc và viết báo cáo không bị lẫn.', 'The library separates academic discovery from reports you create.') },
      { view: 'reports', target: 'library-fields', title: c('Hãy chọn một lĩnh vực', 'Choose a field to continue'), body: c('Bấm một trong năm thẻ đang được làm nổi bật. Tour sẽ tiếp tục trong thư viện paper của lĩnh vực bạn chọn.', 'Select any of the five highlighted cards. The tour will continue inside that field’s paper library.'), clickToAdvance: true },
      { view: 'reports', target: 'paper-search', title: c('Lọc đúng loại công trình', 'Filter the right research'), body: c('Chọn arXiv hoặc tạp chí được tuyển chọn, lọc chủ đề và tìm theo tên hay tác giả. Đây là metadata công khai; không bảo đảm có toàn văn.', 'Choose arXiv or curated journals, filter a topic, and search titles or authors. This is public metadata and does not guarantee full-text access.') },
      { view: 'reports', target: 'paper-results', title: c('Duyệt kết quả', 'Browse the results'), body: c('Chọn một paper ở danh sách để xem abstract, tác giả, ngày và liên kết gốc. Kết quả có thể trống khi nguồn bên ngoài chưa trả lời.', 'Select a paper to inspect its abstract, authors, date, and original link. Results may be empty when external sources are unavailable.') },
      { view: 'reports', target: 'paper-detail', title: c('Lưu để đọc và ghi chú', 'Save and annotate'), body: c('Chỉ khi bạn bấm Lưu bài, paper mới vào tài khoản; sau đó có thể đặt trạng thái đọc, tạo collection và ghi chú. Tour không tự lưu hộ.', 'A paper enters your account only when you press Save. You can then track reading status, organize collections, and add notes. The tour never saves on your behalf.') },
    ],
  },
  host: {
    name: c('Tổng quan Host Console', 'Host Console overview'),
    summary: c('Nắm các màn hình quản trị mà không thay đổi tài khoản.', 'Understand administration without changing any account.'),
    steps: [
      { view: 'admin', target: 'host-hero', title: c('Không gian chỉ dành cho Host', 'A Host-only workspace'), body: c('Quyền Host được kiểm tra trên server theo email cấu hình. Tour chỉ dành cho Host và không cấp quyền mới.', 'Host access is verified on the server against configured email addresses. This tour does not grant any access.') },
      { view: 'admin', target: 'host-tabs', title: c('Năm khu vực quản trị', 'Five administration areas'), body: c('Xem tổng quan, thành viên, báo cáo, hoạt động và hệ thống. Bạn luôn nên kiểm tra đúng tài khoản trước thao tác ảnh hưởng dữ liệu.', 'Review overview, members, reports, activity, and system. Always verify the account before an action that affects data.') },
      { view: 'admin', target: 'host-health', title: c('Bắt đầu từ sức khỏe hệ thống', 'Start with system health'), body: c('Các số liệu và trạng thái giúp phát hiện cấu hình thiếu hoặc phiên đang chạy. Tour sẽ không khóa user, sửa license hoặc xóa báo cáo.', 'Metrics and status help identify configuration gaps and running sessions. The tour never suspends users, changes licenses, or deletes reports.') },
    ],
  },
};

const labels = {
  vi: { inviteKicker: 'CHÀO MỪNG BẠN', inviteTitle: 'Khám phá Nexora theo cách của bạn.', inviteBody: 'Một chuyến tham quan ngắn ngay trên giao diện thật. Không chạy research, không thay đổi dữ liệu và có thể dừng bất cứ lúc nào.', start: 'Bắt đầu tour', later: 'Để sau', catalog: 'Chọn tour', catalogTitle: 'Bạn muốn khám phá phần nào?', catalogBody: 'Tour chính cho bạn bức tranh tổng thể; các tour ngắn đi sâu vào từng công cụ.', resume: 'Tiếp tục', replay: 'Xem lại', explore: 'Bắt đầu', complete: 'Đã hoàn tất', inProgress: 'Đang xem', dismissed: 'Chưa hoàn tất', close: 'Đóng', step: 'Bước', back: 'Quay lại', next: 'Tiếp tục', finish: 'Hoàn tất', pause: 'Tạm dừng', skip: 'Bỏ qua tour', choose: 'Chọn một thẻ để tiếp tục', focus: 'Đến mục được làm nổi bật', unavailable: 'Mục này chưa sẵn sàng. Bạn có thể bỏ qua bước này hoặc thử lại.', retry: 'Thử lại', syncWarning: 'Tiến độ đang lưu trên thiết bị này; sẽ đồng bộ lại khi kết nối phục hồi.', help: 'Tour hướng dẫn' },
  en: { inviteKicker: 'WELCOME', inviteTitle: 'Explore Nexora at your pace.', inviteBody: 'A short walkthrough on the real interface. It never runs research or changes your data, and you can stop any time.', start: 'Start tour', later: 'Maybe later', catalog: 'Choose a tour', catalogTitle: 'What would you like to explore?', catalogBody: 'The main tour gives you the big picture; shorter tours focus on each tool.', resume: 'Resume', replay: 'Replay', explore: 'Start', complete: 'Completed', inProgress: 'In progress', dismissed: 'Not finished', close: 'Close', step: 'Step', back: 'Back', next: 'Continue', finish: 'Finish', pause: 'Pause', skip: 'Skip tour', choose: 'Choose a card to continue', focus: 'Go to highlighted control', unavailable: 'This section is not ready. Skip this step or try again.', retry: 'Try again', syncWarning: 'Progress is saved on this device and will sync when the connection returns.', help: 'Guided tour' },
};

function storeKey(userId: string) { return `nexora-onboarding:${userId}`; }
function readLocal(userId: string): Record<string, TourProgress> {
  try {
    const value = JSON.parse(window.localStorage.getItem(storeKey(userId)) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([id, row]) =>
      Object.prototype.hasOwnProperty.call(tours, id) && row && typeof row === 'object' &&
      (row as TourProgress).tour_id === id &&
      (row as TourProgress).version === TOUR_VERSION &&
      Number.isInteger((row as TourProgress).step_index) &&
      (row as TourProgress).step_index >= 0 &&
      (row as TourProgress).step_index <= tours[id as TourId].steps.length &&
      ['dismissed', 'in_progress', 'completed'].includes((row as TourProgress).status) &&
      ((row as TourProgress).status === 'completed') === ((row as TourProgress).step_index === tours[id as TourId].steps.length) &&
      typeof (row as TourProgress).updated_at === 'string'
    )) as Record<string, TourProgress>;
  } catch { return {}; }
}
function writeLocal(userId: string, value: Record<string, TourProgress>) {
  try { window.localStorage.setItem(storeKey(userId), JSON.stringify(value)); } catch { /* Continue without local storage. */ }
}

interface Props {
  apiBase: string;
  user: AuthUser;
  language: Language;
  activeView: AppView;
  showWelcome: boolean;
  request: TourRequest;
  clearRequest: () => void;
  onNavigate: (view: AppView) => void;
  onResetLibrary: () => void;
  hideLauncher?: boolean;
}

export function GuidedTour({ apiBase, user, language, activeView, showWelcome, request, clearRequest, onNavigate, onResetLibrary, hideLauncher = false }: Props) {
  const t = labels[language];
  const [progress, setProgress] = useState<Record<string, TourProgress>>({});
  const progressRef = useRef<Record<string, TourProgress>>({});
  const [loaded, setLoaded] = useState(false);
  const [syncWarning, setSyncWarning] = useState(false);
  const [invitation, setInvitation] = useState(false);
  const [catalog, setCatalog] = useState(false);
  const [active, setActive] = useState<ActiveTour | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [missing, setMissing] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [cardHeight, setCardHeight] = useState(400);
  const dialogRef = useRef<HTMLDivElement>(null);
  const promptHandled = useRef(false);
  const pendingView = useRef<AppView | null>(null);
  const pendingWrites = useRef<Record<string, Promise<void>>>({});
  const activeRef = useRef<ActiveTour | null>(null);
  const handoffHandled = useRef(false);
  activeRef.current = active;

  const tourOpen = Boolean(active || catalog || invitation);
  useEffect(() => {
    if (!tourOpen) return;
    const origin = document.activeElement as HTMLElement | null;
    return () => {
      const destination = origin?.isConnected ? origin : document.querySelector<HTMLElement>('.user-menu-trigger, .brand-button');
      destination?.focus();
    };
  }, [tourOpen]);

  useEffect(() => {
    if (!catalog && !invitation) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [catalog, invitation]);

  useEffect(() => { if (pendingView.current === activeView) pendingView.current = null; }, [activeView]);

  const requestView = (view: AppView) => {
    if (activeView === view || pendingView.current === view) return;
    pendingView.current = view;
    onNavigate(view);
  };

  const queueWrite = (id: TourId, row: TourProgress) => {
    pendingWrites.current[id] = (pendingWrites.current[id] || Promise.resolve()).catch(() => {}).then(async () => {
      const response = await fetch(`${apiBase}/api/auth/onboarding/${id}`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: row.version, step_index: row.step_index, status: row.status }),
      });
      if (!response.ok) throw new Error('Could not save onboarding');
      const payload = await response.json() as { tour: TourProgress };
      const current = progressRef.current[id];
      if (current?.updated_at === row.updated_at && current.step_index === row.step_index && current.status === row.status) {
        const next = { ...progressRef.current, [id]: payload.tour };
        progressRef.current = next;
        setProgress(next);
        writeLocal(user.id, next);
      }
      setSyncWarning(false);
    }).catch(() => setSyncWarning(true));
  };

  useEffect(() => {
    let cancelled = false;
    promptHandled.current = false;
    setLoaded(false);
    const local = readLocal(user.id);
    progressRef.current = local;
    setProgress(local);
    const load = async () => {
      try {
        const response = await fetch(`${apiBase}/api/auth/onboarding`, { credentials: 'include', signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('Could not load onboarding');
        const payload = await response.json() as { tours?: TourProgress[] };
        if (cancelled) return;
        const server = Object.fromEntries((payload.tours || []).filter((row) => row.version === TOUR_VERSION && (row.tour_id !== 'host' || user.role === 'admin')).map((row) => [row.tour_id, row]));
        const merged = { ...server };
        const pendingSync: [TourId, TourProgress][] = [];
        for (const [id, row] of Object.entries(local)) {
          if (row.version === TOUR_VERSION && (id !== 'host' || user.role === 'admin') && (!merged[id] || new Date(row.updated_at).getTime() > new Date(merged[id].updated_at).getTime())) {
            merged[id] = row;
            pendingSync.push([id as TourId, row]);
          }
        }
        progressRef.current = merged;
        setProgress(merged);
        writeLocal(user.id, merged);
        setSyncWarning(false);
        pendingSync.forEach(([id, row]) => queueWrite(id, row));
      } catch { if (!cancelled) setSyncWarning(true); }
      if (!cancelled) setLoaded(true);
    };
    void load();
    return () => { cancelled = true; };
  }, [apiBase, user.id]);

  useEffect(() => {
    if (!loaded) return;
    const retry = () => Object.values(progressRef.current).forEach((row) => {
      if (row.tour_id !== 'host' || user.role === 'admin') queueWrite(row.tour_id, row);
    });
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [loaded, apiBase, user.id, user.role]);

  const persist = (id: TourId, index: number, status: TourStatus) => {
    const row: TourProgress = { tour_id: id, version: TOUR_VERSION, step_index: index, status, updated_at: new Date().toISOString() };
    const next = { ...progressRef.current, [id]: row };
    progressRef.current = next;
    setProgress(next);
    writeLocal(user.id, next);
    queueWrite(id, row);
  };

  const start = (id: TourId) => {
    if (id === 'host' && user.role !== 'admin') return;
    const saved = progressRef.current[id];
    let index = saved?.version === TOUR_VERSION && saved.status === 'in_progress' ? Math.min(saved.step_index, tours[id].steps.length - 1) : 0;
    // A paper's field selection lives in the Library UI, not in tour progress.
    // Resume at the choice instead of pointing at a detail pane that is no longer open.
    if (id === 'library' && index >= 2) index = 1;
    if (id === 'fields') {
      if (fieldRoute(window.location.hash)) index = Math.max(1, index);
      else { index = 0; window.location.hash = '#/fields'; }
    }
    setInvitation(false);
    setCatalog(false);
    setActive({ id, index });
    if (id === 'library' || (id === 'core' && activeView === 'reports')) onResetLibrary();
    persist(id, index, 'in_progress');
    const view = tours[id].steps[index].view;
    requestView(view);
  };

  useEffect(() => {
    if (!loaded || handoffHandled.current) return;
    const url = new URL(window.location.href);
    const route = fieldRoute(url.hash);
    if (!route || !url.searchParams.has(handoffParameter)) return;
    handoffHandled.current = true;
    let intent: ReturnType<typeof consumeFieldTour> = null;
    try { intent = consumeFieldTour(url, user.id, route.field, window.localStorage); } catch { setSyncWarning(true); }
    window.history.replaceState(window.history.state, '', withoutTourHandoff(url));
    if (!intent) return;
    setInvitation(false); setCatalog(false); setMissing(false); setBox(null);
    setActive({ id: 'fields', index: intent.step });
    persist('fields', intent.step, 'in_progress');
    requestView('domains');
  }, [loaded, user.id]);

  useEffect(() => {
    if (!loaded || !request) return;
    if (request === 'catalog') { setInvitation(false); setActive(null); setCatalog(true); }
    else start(request);
    clearRequest();
  }, [request, loaded]);

  useEffect(() => {
    if (!loaded || promptHandled.current || showWelcome || request || active || catalog || activeView !== 'overview') return;
    if (Number(user.login_count) === 1 && !progressRef.current.core) {
      promptHandled.current = true;
      setInvitation(true);
    }
  }, [loaded, showWelcome, request, active, catalog, activeView, user.login_count]);

  const move = (delta: number) => {
    if (!active) return;
    const nextIndex = active.index + delta;
    const steps = tours[active.id].steps;
    if (nextIndex >= steps.length) { persist(active.id, steps.length, 'completed'); setActive(null); setCatalog(true); return; }
    const index = Math.max(0, nextIndex);
    if (active.id === 'library' && active.index >= 2 && index <= 1) onResetLibrary();
    if (active.id === 'fields' && index === 0) window.location.hash = '#/fields';
    setActive({ ...active, index });
    setBox(null);
    setMissing(false);
    persist(active.id, index, 'in_progress');
    requestView(steps[index].view);
  };

  const pause = () => { if (active) persist(active.id, active.index, 'in_progress'); setActive(null); setBox(null); };
  const skip = () => { if (active) persist(active.id, active.index, 'dismissed'); setActive(null); setBox(null); };
  const step = active ? tours[active.id].steps[active.index] : null;

  useEffect(() => {
    if (!active || !dialogRef.current) return;
    const card = dialogRef.current;
    const observer = new ResizeObserver(() => setCardHeight(card.getBoundingClientRect().height));
    observer.observe(card);
    setCardHeight(card.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [active?.id, active?.index, language, syncWarning, missing]);

  useEffect(() => {
    if (!active || !step) return;
    if (activeView !== step.view) { requestView(step.view); return; }
    if (active.id === 'fields') window.dispatchEvent(new CustomEvent('nexora:field-tour-target', { detail: step.target }));
    let frame = 0;
    let target: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let scrolled = false;
    const update = () => {
      const found = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (!found) { target = null; setBox(null); return; }
      if (found !== target) {
        target = found;
        // The workspace can mount after the tour (API loading / lazy import).
        if (active.id === 'fields') window.dispatchEvent(new CustomEvent('nexora:field-tour-target', { detail: step.target }));
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(update); });
        resizeObserver.observe(found);
      }
      if (!scrolled) { scrolled = true; found.scrollIntoView({ block: window.innerWidth < 700 ? 'start' : 'center', inline: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }
      const rect = found.getBoundingClientRect();
      setBox({ top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
      setMissing(false);
    };
    const observe = new MutationObserver(() => { if (!target || !target.isConnected) update(); });
    observe.observe(document.body, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => { if (!target?.isConnected) { setMissing(true); setBox(null); } }, active.id === 'fields' ? 20000 : 6000);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    document.addEventListener('transitionend', update, true);
    update();
    return () => { observe.disconnect(); resizeObserver?.disconnect(); window.clearTimeout(timeout); window.cancelAnimationFrame(frame); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); document.removeEventListener('transitionend', update, true); };
  }, [active?.id, active?.index, activeView, retryTick]);

  useEffect(() => {
    if (!active || !step?.clickToAdvance || activeView !== step.view) return;
    const onClick = (event: MouseEvent) => {
      if (event.type === 'auxclick' && event.button !== 1) return;
      const target = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (!target?.contains(event.target as Node)) return;
      if (step.target === 'library-fields' && !(event.target as Element).closest('button')) return;
      if (step.target === 'field-picker' && !(event.target as Element).closest('a')) return;
      const link = (event.target as Element).closest('a');
      if (step.target === 'field-picker' && link && (link.getAttribute('target') === '_blank' || event.ctrlKey || event.metaKey || event.type === 'auxclick')) {
        const destination = new URL(link.href);
        const route = fieldRoute(destination.hash);
        if (!route || destination.origin !== window.location.origin) return;
        const previousHref = link.href;
        try {
          link.href = stageFieldTour(destination, user.id, route.field, crypto.randomUUID(), window.localStorage);
        } catch { setSyncWarning(true); return; }
        // Change href synchronously before the browser's normal new-tab action.
        // Restore it afterwards so future non-tour clicks remain ordinary links.
        window.setTimeout(() => { link.href = previousHref; }, 0);
        persist(active.id, active.index + 1, 'in_progress'); setActive(null); setBox(null); return;
      }
      if (step.target === 'nav-research') pendingView.current = 'research';
      window.setTimeout(() => { if (activeRef.current?.id === active.id && activeRef.current.index === active.index) move(1); }, 0);
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('auxclick', onClick, true);
    return () => { document.removeEventListener('click', onClick, true); document.removeEventListener('auxclick', onClick, true); };
  }, [active?.id, active?.index, activeView]);

  useEffect(() => {
    if (!active && !catalog && !invitation) return;
    const id = window.requestAnimationFrame(() => dialogRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (activeRef.current) pause(); else { setCatalog(false); if (invitation) persist('core', 0, 'dismissed'); setInvitation(false); } }
      if (event.key === 'Tab' && !activeRef.current && dialogRef.current) {
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)'));
        if (items.length) {
          const first = items[0]; const last = items[items.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }
      if (!activeRef.current) return;
      if (!dialogRef.current?.contains(event.target as Node)) return;
      if ((event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
      if (event.key === 'ArrowRight' && !tours[activeRef.current.id].steps[activeRef.current.index].clickToAdvance) { event.preventDefault(); move(1); }
    };
    document.addEventListener('keydown', onKey);
    return () => { window.cancelAnimationFrame(id); document.removeEventListener('keydown', onKey); };
  }, [active?.id, active?.index, catalog, invitation]);

  const ids: TourId[] = user.role === 'admin' ? ['core', 'research', 'fields', 'library', 'host'] : ['core', 'research', 'fields', 'library'];
  const currentViewTour: TourId | null = activeView === 'research' ? 'research' : activeView === 'domains' ? 'fields' : activeView === 'reports' ? 'library' : activeView === 'admin' && user.role === 'admin' ? 'host' : null;
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
  const inset = box ? {
    left: clamp(box.left - 8, window.innerWidth),
    top: clamp(box.top - 8, window.innerHeight),
    right: clamp(box.right + 8, window.innerWidth),
    bottom: clamp(box.bottom + 8, window.innerHeight),
  } : null;
  const visibleInset = inset && inset.right > inset.left && inset.bottom > inset.top ? inset : null;
  const cardPosition = (() => {
    if (!visibleInset) return {};
    const width = Math.min(390, window.innerWidth - 28);
    const height = Math.min(cardHeight, window.innerHeight - 28);
    if (window.innerWidth < 700) return {};
    if (visibleInset.right + width + 20 < window.innerWidth) return { top: Math.max(14, Math.min(visibleInset.top, window.innerHeight - height - 14)), left: visibleInset.right + 14 };
    if (visibleInset.left - width - 20 > 0) return { top: Math.max(14, Math.min(visibleInset.top, window.innerHeight - height - 14)), left: visibleInset.left - width - 14 };
    if (visibleInset.bottom + height + 18 < window.innerHeight) return { top: visibleInset.bottom + 14, left: Math.max(14, Math.min(visibleInset.left, window.innerWidth - width - 14)) };
    if (visibleInset.top - height - 18 > 0) return { top: visibleInset.top - height - 14, left: Math.max(14, Math.min(visibleInset.left, window.innerWidth - width - 14)) };
    return { top: Math.max(14, window.innerHeight - height - 16), left: Math.max(14, window.innerWidth - width - 16) };
  })();

  return <>
    {!hideLauncher && loaded && !active && !catalog && !invitation && currentViewTour && <button type="button" className="tour-help-button" onClick={() => start(currentViewTour)}><HelpCircle size={18} />{t.help}</button>}
    {(invitation || catalog || active) && createPortal(<div className="tour-layer">
      {active ? <>
        {visibleInset ? <>
          <div className="tour-shade" style={{ top: 0, left: 0, right: 0, height: visibleInset.top }} />
          <div className="tour-shade" style={{ top: visibleInset.bottom, left: 0, right: 0, bottom: 0 }} />
          <div className="tour-shade" style={{ top: visibleInset.top, left: 0, width: visibleInset.left, height: visibleInset.bottom - visibleInset.top }} />
          <div className="tour-shade" style={{ top: visibleInset.top, left: visibleInset.right, right: 0, height: visibleInset.bottom - visibleInset.top }} />
          <div className="tour-spotlight" style={{ top: visibleInset.top, left: visibleInset.left, width: visibleInset.right - visibleInset.left, height: visibleInset.bottom - visibleInset.top }} />
        </> : <div className="tour-shade tour-shade--full" />}
        <div className="tour-card" style={cardPosition} role="dialog" aria-labelledby="tour-step-title" aria-describedby="tour-step-body" tabIndex={-1} ref={dialogRef}>
          <div className="tour-card__top"><span><Compass size={15} />{tours[active.id].name[language]}</span><button type="button" aria-label={t.pause} onClick={pause}><X size={18} /></button></div>
          <div className="tour-progress-line" aria-hidden="true"><i style={{ width: `${((active.index + 1) / tours[active.id].steps.length) * 100}%` }} /></div>
          <small className="tour-count">{t.step} {active.index + 1} / {tours[active.id].steps.length}</small>
          <h2 id="tour-step-title">{step?.title[language]}</h2>
          <p id="tour-step-body">{missing ? t.unavailable : step?.body[language]}</p>
          {syncWarning && <p className="tour-sync-note">{t.syncWarning}</p>}
          <div className="tour-card__actions"><button type="button" className="tour-text-button" onClick={skip}>{t.skip}</button><div><button type="button" className="tour-back" disabled={active.index === 0} onClick={() => move(-1)}><ArrowLeft size={15} />{t.back}</button>{step?.clickToAdvance && !missing ? <button type="button" className="tour-next" onClick={() => { const target = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`); const control = step.target === 'library-fields' ? target?.querySelector<HTMLElement>('button') : step.target === 'field-picker' ? target?.querySelector<HTMLElement>('a') : target; control?.focus(); if (step.target === 'nav-research') control?.click(); }}>{['library-fields', 'field-picker'].includes(step.target) ? t.choose : t.next}<ArrowRight size={15} /></button> : <button type="button" className="tour-next" onClick={() => move(1)}>{active.index === tours[active.id].steps.length - 1 ? t.finish : t.next}<ArrowRight size={15} /></button>}</div></div>
          {missing && <button type="button" className="tour-retry" onClick={() => { setMissing(false); setRetryTick((value) => value + 1); }}>{t.retry}</button>}
        </div>
      </> : <>
        <div className="tour-shade tour-shade--full" onClick={() => { setCatalog(false); if (invitation) { persist('core', 0, 'dismissed'); setInvitation(false); } }} />
        <div className="tour-modal" role="dialog" aria-modal="true" aria-labelledby="tour-modal-title" tabIndex={-1} ref={dialogRef}>
          <button className="tour-modal__close" type="button" aria-label={t.close} onClick={() => { setCatalog(false); if (invitation) { persist('core', 0, 'dismissed'); setInvitation(false); } }}><X size={19} /></button>
          <span className="tour-modal__icon">{invitation ? <Compass size={28} /> : <BookOpenCheck size={28} />}</span>
          <span className="tour-modal__eyebrow">{invitation ? t.inviteKicker : t.catalog}</span>
          <h2 id="tour-modal-title">{invitation ? t.inviteTitle : t.catalogTitle}</h2>
          <p>{invitation ? t.inviteBody : t.catalogBody}</p>
          {syncWarning && <p className="tour-sync-note">{t.syncWarning}</p>}
          {invitation ? <div className="tour-modal__actions"><button type="button" className="tour-next" onClick={() => start('core')}><Play size={17} />{t.start}</button><button type="button" className="tour-back" onClick={() => { persist('core', 0, 'dismissed'); setInvitation(false); }}>{t.later}</button></div> : <div className="tour-catalog">{ids.map((id) => { const saved = progress[id]; return <button key={id} type="button" onClick={() => start(id)}><span className="tour-catalog__icon">{saved?.status === 'completed' ? <Check size={20} /> : id === 'host' ? <ShieldCheck size={20} /> : <Compass size={20} />}</span><span><strong>{tours[id].name[language]}</strong><small>{tours[id].summary[language]}</small><em>{saved?.status === 'completed' ? t.complete : saved?.status === 'in_progress' ? `${t.inProgress} · ${saved.step_index + 1}/${tours[id].steps.length}` : saved?.status === 'dismissed' ? t.dismissed : `${tours[id].steps.length} ${t.step.toLowerCase()}`}</em></span><span className="tour-catalog__action">{saved?.status === 'in_progress' ? <Pause size={17} /> : saved?.status === 'completed' ? <RotateCcw size={17} /> : <ArrowRight size={17} />}</span></button>; })}</div>}
        </div>
      </>}
    </div>, document.body)}
  </>;
}
