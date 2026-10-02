import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { profileCompletionFromHash, profileSetupHash, type ProfileCompletion } from './profileNavigation';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Cpu,
  Database,
  Download,
  FileText,
  Globe2,
  LoaderCircle,
  RefreshCw,
  Search,
  Send,
  Shapes,
  ShieldCheck,
  Sparkles,
  Square,
  Users,
  X,
  Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ProductNavigation,
  WorkspaceHub,
  type AppView,
  type Health,
  type Language,
  type ResearchDepth,
  type StoredReportDetail,
  type StoredReportSummary,
} from "./ProductViews";
import {
  LoginPage,
  UserMenu,
  WelcomeTransition,
  type Appearance,
  type AuthProviders,
  type AuthUser,
} from "./Auth";
import { AdminConsole } from "./AdminConsole";
import { AppFooter } from "./AppFooter";
import { BrandMark } from "./BrandMark";
import type { TourRequest } from "./GuidedTour";
import type { DomainResearchPayload } from "./DomainHub";
import {
  InformationPage,
  PublicInformationFooter,
  PublicInformationHeader,
  informationViewFromHash,
  type InformationView,
} from "./InformationPages";

const DomainHub = lazy(() =>
  import("./DomainHub").then((module) => ({ default: module.DomainHub })),
);
const GuidedTour = lazy(() =>
  import("./GuidedTour").then((module) => ({ default: module.GuidedTour })),
);
const GuidePage = lazy(() =>
  import("./GuidePricing").then((module) => ({ default: module.GuidePage })),
);
const PricingPage = lazy(() =>
  import("./GuidePricing").then((module) => ({ default: module.PricingPage })),
);
const UserProfile = lazy(() =>
  import("./UserProfile").then((module) => ({ default: module.UserProfile })),
);
const CollaborationHub = lazy(() =>
  import("./CollaborationHub").then((module) => ({ default: module.CollaborationHub })),
);

function routedViewFromHash(
  hash = window.location.hash,
): "guide" | "pricing" | "profile" | "collab" | null {
  if (/^#\/guide(?:\/|$)/.test(hash)) return "guide";
  if (/^#\/pricing(?:\/|$)/.test(hash)) return "pricing";
  if (/^#\/profile(?:\/|\?|$)/.test(hash)) return "profile";
  if (/^#\/collab(?:\/|$)/.test(hash)) return "collab";
  return null;
}

type Status =
  | "idle"
  | "connecting"
  | "running"
  | "review_analysts"
  | "review_sections"
  | "completed"
  | "error";
type Phase = "setup" | "analysts" | "research" | "synthesis" | "done";

interface Analyst {
  name: string;
  role: string;
  affiliation: string;
  description: string;
}

interface ServerMessage {
  event: string;
  node?: string;
  details?: string;
  analysts?: Analyst[];
  sections?: string[];
  interrupt_type?: "human_feedback" | "human_review_section";
  message?: string;
  final_report?: string;
  filepath?: string;
  source_count?: number;
  research_depth?: ResearchDepth;
  audit_notes?: string;
}

interface ActivityItem {
  id: number;
  label: string;
  detail?: string;
  time: string;
}

const translations = {
  vi: {
    documentTitle: "Nexora — Không gian nghiên cứu AI",
    languageLabel: "Chọn ngôn ngữ",
    brandSubtitle: "A better place to explore ideas",
    health: {
      checking: "Đang kiểm tra backend",
      online: "Backend online",
      offline: "Backend offline",
    },
    showcase: {
      badge: "Multi-agent research engine",
      title: "Từ một câu hỏi đến báo cáo có nguồn.",
      description:
        "Không gian nghiên cứu chuyên sâu kết hợp Gemini, nhiều analyst AI và tìm kiếm đa nguồn để biến một brief thành báo cáo có cấu trúc.",
      cardTitle: "RESEARCH PIPELINE",
      cardBadge: "LIVE WORKFLOW",
      topicLabel: "Brief đang phân tích",
      sampleTopic: "Chủ đề của bạn sẽ xuất hiện ở đây",
      steps: [
        "Đặt vấn đề",
        "Tạo góc nhìn",
        "Tìm bằng chứng",
        "Biên tập report",
      ],
      metrics: [
        { value: "2+", label: "nguồn tìm kiếm" },
        { value: "1–3", label: "analyst song song" },
        { value: ".MD", label: "report tải xuống" },
      ],
      assurances: [
        "Tavily + Wikipedia",
        "Gemini tổng hợp",
        "LangGraph điều phối",
      ],
    },
    brief: {
      eyebrow: "Research brief",
      title: "Bạn muốn tìm hiểu điều gì?",
      description: "Mô tả chủ đề, phạm vi và câu hỏi mà báo cáo cần trả lời.",
      topicLabel: "Chủ đề nghiên cứu",
      placeholder:
        "Ví dụ: Phân tích ưu, nhược điểm và chi phí triển khai chatbot RAG cho doanh nghiệp bán lẻ Việt Nam",
      characters: "ký tự",
      suggestions: "Thử một chủ đề",
      topics: [
        "So sánh RAG và fine-tuning cho chatbot tiếng Việt",
        "Ứng dụng AI trong vận hành doanh nghiệp vừa và nhỏ",
        "Xu hướng thanh toán không tiền mặt tại Việt Nam",
      ],
      analystsLabel: "Số analyst",
      analystOptions: [
        "1 · Tiết kiệm quota",
        "2 · Nhiều góc nhìn",
        "3 · Chuyên sâu",
      ],
      depthLabel: "Độ sâu nghiên cứu",
      depthDescription:
        "Mỗi mức thay đổi số vòng hỏi, lượng truy vấn và bước kiểm chứng.",
      depthOptions: {
        quick: {
          title: "Nhanh",
          description: "Tóm lược có nguồn",
          meta: "1 vòng · 1 query",
        },
        standard: {
          title: "Tiêu chuẩn",
          description: "Đa góc nhìn và lập kế hoạch",
          meta: "1 vòng · 2 query",
        },
        deep: {
          title: "Chuyên sâu",
          description: "Đào sâu, duyệt nguồn và audit",
          meta: "2 vòng · 3 query/vòng",
        },
      },
      autoApprove: "Tự động duyệt",
      autoApproveHint: "Không dừng chờ feedback",
      quotaWarning:
        "Chế độ chuyên sâu dùng nhiều lượt Gemini và Tavily hơn. Free tier có thể chạm giới hạn.",
      start: "Bắt đầu nghiên cứu",
      restart: "Nghiên cứu lại chủ đề này",
      stop: "Dừng phiên này",
      backendHint: "Hãy khởi động backend trước khi bắt đầu.",
      modelNote: "Gemini tạo nội dung · Tavily và Wikipedia cung cấp nguồn",
    },
    status: {
      idle: "Sẵn sàng bắt đầu",
      connecting: "Đang mở phiên nghiên cứu",
      running: "Agent đang làm việc",
      review_analysts: "Cần bạn duyệt nhóm analyst",
      review_sections: "Cần bạn duyệt các section",
      completed: "Báo cáo đã hoàn tất",
      error: "Phiên nghiên cứu gặp lỗi",
    },
    phases: {
      setup: { label: "Chuẩn bị", caption: "Kết nối và nạp hồ sơ" },
      analysts: { label: "Góc nhìn", caption: "Thiết kế nhóm analyst" },
      research: { label: "Nghiên cứu", caption: "Phỏng vấn và tìm nguồn" },
      synthesis: { label: "Tổng hợp", caption: "Biên tập báo cáo" },
      done: { label: "Hoàn tất", caption: "Report sẵn sàng" },
    },
    nodes: {
      start: "Đã nhận yêu cầu nghiên cứu",
      load_research_profile: "Đã nạp hồ sơ nghiên cứu",
      create_analysts: "Đã tạo nhóm analyst",
      plan_research: "Đã lập kế hoạch và tiêu chí bằng chứng",
      human_feedback: "Đã duyệt nhóm analyst",
      conduct_interview: "Một cuộc phỏng vấn đã hoàn tất",
      human_review_section: "Đã duyệt các section",
      write_report: "Đã viết nội dung chính",
      write_introduction: "Đã viết phần mở đầu",
      write_conclusion: "Đã viết phần kết luận",
      finalize_report: "Đã ráp báo cáo hoàn chỉnh",
      audit_report: "Đã kiểm tra bằng chứng và citation",
      save_research_profile: "Đã lưu hồ sơ nghiên cứu",
    },
    workspace: {
      eyebrow: "Live workspace",
      newTopic: "Chủ đề mới",
      progressLabel: "Tiến trình nghiên cứu",
      emptyTitle: "Một brief, nhiều bước tự động",
      emptyDescription:
        "Agent sẽ thiết kế góc nhìn, tìm nguồn, phỏng vấn và biên tập thành report Markdown.",
      facts: ["Analyst theo chủ đề", "Tìm kiếm đa nguồn", "Report có cấu trúc"],
      runningSuffix: "Bạn có thể để cửa sổ này chạy nền.",
      analystReviewTitle: "Duyệt nhóm analyst",
      analystReviewDescription:
        "Chấp nhận danh sách hoặc mô tả góc nhìn bạn muốn thay đổi.",
      analystFeedback: "Ví dụ: thêm góc nhìn về chi phí triển khai...",
      sectionReviewTitle: "Duyệt nội dung nghiên cứu",
      sectionReviewDescription:
        "Các interview đã xong. Kiểm tra phạm vi trước khi biên tập report.",
      sectionFeedback: "Ví dụ: nhấn mạnh thêm rủi ro và số liệu thị trường...",
      feedbackLabel: "Feedback chỉnh sửa",
      submitFeedback: "Gửi chỉnh sửa",
      approve: "Duyệt và tiếp tục",
      errorTitle: "Chưa thể hoàn tất report",
      retry: "Thử lại",
      reportSaved: "Đã lưu trên máy",
      reportReady: "Report hoàn tất",
      sourcesUsed: "nguồn đã dùng",
      audited: "Đã audit citation",
      copyReport: "Sao chép report",
      download: "Tải Markdown",
      copied: "Đã sao chép report",
      recentActivity: "Hoạt động gần đây",
      steps: "bước",
    },
    activity: {
      approved: "Đã duyệt và tiếp tục",
      revisionSent: "Đã gửi yêu cầu chỉnh sửa",
      completed: "Báo cáo đã sẵn sàng",
      cancelled: "Đã dừng phiên nghiên cứu",
      unknown: "Một bước đã hoàn tất",
    },
    errors: {
      backendUnavailable: "Backend chưa sẵn sàng.",
      invalidResponse: "Không đọc được phản hồi từ backend.",
      websocket: "Không thể kết nối WebSocket với backend.",
      closed: "Kết nối đã đóng trước khi báo cáo hoàn tất.",
      unknown: "Backend trả về lỗi không xác định.",
    },
  },
  en: {
    documentTitle: "Nexora — AI Research Workspace",
    languageLabel: "Select language",
    brandSubtitle: "A better place to explore ideas",
    health: {
      checking: "Checking backend",
      online: "Backend online",
      offline: "Backend offline",
    },
    showcase: {
      badge: "Multi-agent research engine",
      title: "From one question to a sourced report.",
      description:
        "A focused research workspace combining Gemini, multiple AI analysts, and multi-source search to turn a brief into a structured report.",
      cardTitle: "RESEARCH PIPELINE",
      cardBadge: "LIVE WORKFLOW",
      topicLabel: "Brief in focus",
      sampleTopic: "Your research topic will appear here",
      steps: [
        "Frame the brief",
        "Create viewpoints",
        "Find evidence",
        "Edit the report",
      ],
      metrics: [
        { value: "2+", label: "search sources" },
        { value: "1–3", label: "parallel analysts" },
        { value: ".MD", label: "downloadable report" },
      ],
      assurances: [
        "Tavily + Wikipedia",
        "Gemini synthesis",
        "LangGraph orchestration",
      ],
    },
    brief: {
      eyebrow: "Research brief",
      title: "What would you like to explore?",
      description:
        "Describe the topic, scope, and questions the report should answer.",
      topicLabel: "Research topic",
      placeholder:
        "Example: Analyze the benefits, limitations, and implementation cost of RAG chatbots for Vietnamese retailers",
      characters: "characters",
      suggestions: "Try a topic",
      topics: [
        "Compare RAG and fine-tuning for Vietnamese chatbots",
        "AI applications in small and medium business operations",
        "Cashless payment trends in Vietnam",
      ],
      analystsLabel: "Analysts",
      analystOptions: ["1 · Save quota", "2 · More viewpoints", "3 · In depth"],
      depthLabel: "Research depth",
      depthDescription:
        "Each level changes interview rounds, query volume, and verification.",
      depthOptions: {
        quick: {
          title: "Quick",
          description: "Sourced overview",
          meta: "1 round · 1 query",
        },
        standard: {
          title: "Standard",
          description: "Multiple viewpoints and planning",
          meta: "1 round · 2 queries",
        },
        deep: {
          title: "Deep",
          description: "Source screening, follow-ups, and audit",
          meta: "2 rounds · 3 queries/round",
        },
      },
      autoApprove: "Auto approve",
      autoApproveHint: "Do not pause for feedback",
      quotaWarning:
        "Deep mode uses more Gemini and Tavily calls. Free tiers may reach their limits.",
      start: "Start research",
      restart: "Research this topic again",
      stop: "Stop this session",
      backendHint: "Start the backend before beginning.",
      modelNote:
        "Gemini creates content · Tavily and Wikipedia provide sources",
    },
    status: {
      idle: "Ready to begin",
      connecting: "Opening research session",
      running: "Agents are working",
      review_analysts: "Review the analyst team",
      review_sections: "Review the report sections",
      completed: "Your report is complete",
      error: "The research session failed",
    },
    phases: {
      setup: { label: "Setup", caption: "Connect and load profile" },
      analysts: { label: "Viewpoints", caption: "Design the analyst team" },
      research: { label: "Research", caption: "Interview and find sources" },
      synthesis: { label: "Synthesis", caption: "Edit the report" },
      done: { label: "Complete", caption: "Report is ready" },
    },
    nodes: {
      start: "Research request received",
      load_research_profile: "Research profile loaded",
      create_analysts: "Analyst team created",
      plan_research: "Research plan and evidence criteria created",
      human_feedback: "Analyst team approved",
      conduct_interview: "An interview was completed",
      human_review_section: "Report sections approved",
      write_report: "Main report written",
      write_introduction: "Introduction written",
      write_conclusion: "Conclusion written",
      finalize_report: "Final report assembled",
      audit_report: "Evidence and citations audited",
      save_research_profile: "Research profile saved",
    },
    workspace: {
      eyebrow: "Live workspace",
      newTopic: "New topic",
      progressLabel: "Research progress",
      emptyTitle: "One brief, many automated steps",
      emptyDescription:
        "The agents design viewpoints, find sources, conduct interviews, and edit a Markdown report.",
      facts: [
        "Topic-specific analysts",
        "Multi-source search",
        "Structured report",
      ],
      runningSuffix: "You can leave this window running in the background.",
      analystReviewTitle: "Review the analyst team",
      analystReviewDescription:
        "Approve the list or describe the viewpoints you want changed.",
      analystFeedback:
        "Example: add a viewpoint focused on implementation cost...",
      sectionReviewTitle: "Review the research content",
      sectionReviewDescription:
        "The interviews are done. Check the scope before report editing.",
      sectionFeedback: "Example: emphasize risks and market data...",
      feedbackLabel: "Revision feedback",
      submitFeedback: "Submit revision",
      approve: "Approve and continue",
      errorTitle: "The report could not be completed",
      retry: "Try again",
      reportSaved: "Saved on this computer",
      reportReady: "Report complete",
      sourcesUsed: "sources used",
      audited: "Citations audited",
      copyReport: "Copy report",
      download: "Download Markdown",
      copied: "Report copied",
      recentActivity: "Recent activity",
      steps: "steps",
    },
    activity: {
      approved: "Approved and continued",
      revisionSent: "Revision request submitted",
      completed: "Report is ready",
      cancelled: "Research session stopped",
      unknown: "A step was completed",
    },
    errors: {
      backendUnavailable: "The backend is not ready.",
      invalidResponse: "Could not read the backend response.",
      websocket: "Could not connect to the backend WebSocket.",
      closed: "The connection closed before the report was complete.",
      unknown: "The backend returned an unknown error.",
    },
  },
} as const;

const configuredApiBase = (
  import.meta.env.VITE_API_BASE_URL as string | undefined
)?.replace(/\/$/, "");
const API_BASE = configuredApiBase || "";
const phaseOrder: Phase[] = [
  "setup",
  "analysts",
  "research",
  "synthesis",
  "done",
];
const depthOrder: ResearchDepth[] = ["quick", "standard", "deep"];
type NodeKey = keyof (typeof translations)["vi"]["nodes"];

const nodePhases: Record<NodeKey, Phase> = {
  start: "setup",
  load_research_profile: "setup",
  create_analysts: "analysts",
  plan_research: "setup",
  human_feedback: "analysts",
  conduct_interview: "research",
  human_review_section: "synthesis",
  write_report: "synthesis",
  write_introduction: "synthesis",
  write_conclusion: "synthesis",
  finalize_report: "synthesis",
  audit_report: "synthesis",
  save_research_profile: "done",
};

function buildWebSocketUrl(): string {
  if (configuredApiBase)
    return `${configuredApiBase.replace(/^http/, "ws")}/ws/research`;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/research`;
}

function nowLabel(language: Language): string {
  return new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function storedPreference<T>(key: string, fallback: T): T {
  try {
    const settings = JSON.parse(
      window.localStorage.getItem("deep-research-settings") || "{}",
    ) as Record<string, unknown>;
    return (settings[key] as T | undefined) ?? fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    try {
      const stored = window.localStorage.getItem("deep-research-appearance");
      return stored === "light" || stored === "dark" ? stored : "system";
    } catch {
      return "system";
    }
  });
  const [language, setLanguage] = useState<Language>(() => {
    const saved = window.localStorage.getItem("deep-research-language");
    return saved === "vi" ? "vi" : "en";
  });
  const [activeView, setActiveView] = useState<AppView>(
    () => routedViewFromHash() || "overview",
  );
  const [informationView, setInformationView] =
    useState<InformationView | null>(() => informationViewFromHash());
  const [topic, setTopic] = useState("");
  const [researchContext, setResearchContext] =
    useState<DomainResearchPayload | null>(null);
  const [collabField, setCollabField] = useState<DomainResearchPayload['domain'] | null>(null);
  const [profileCompletion, setProfileCompletion] = useState<ProfileCompletion | null>(() => profileCompletionFromHash(window.location.hash));
  const [profileEditRequest, setProfileEditRequest] = useState(0);
  const [researchDepth, setResearchDepth] = useState<ResearchDepth>(() =>
    storedPreference("researchDepth", "standard"),
  );
  const [maxAnalysts, setMaxAnalysts] = useState(() =>
    storedPreference("maxAnalysts", 2),
  );
  const [autoApprove, setAutoApprove] = useState(() =>
    storedPreference("autoApprove", true),
  );
  const [status, setStatus] = useState<Status>("idle");
  const [health, setHealth] = useState<Health>("checking");
  const [phase, setPhase] = useState<Phase>("setup");
  const [analysts, setAnalysts] = useState<Analyst[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [finalReport, setFinalReport] = useState("");
  const [serverPath, setServerPath] = useState("");
  const [sourceCount, setSourceCount] = useState(0);
  const [auditNotes, setAuditNotes] = useState("");
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [storedReports, setStoredReports] = useState<StoredReportSummary[]>([]);
  const [selectedReport, setSelectedReport] =
    useState<StoredReportDetail | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [authStatus, setAuthStatus] = useState<
    "checking" | "authenticated" | "unauthenticated"
  >("checking");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authProviders, setAuthProviders] = useState<AuthProviders>({
    google: false,
    github: false,
    dev_login: false,
  });
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [showWelcome, setShowWelcome] = useState(false);
  const [tourRequest, setTourRequest] = useState<TourRequest>(null);
  const [libraryTourReset, setLibraryTourReset] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const autoApproveRef = useRef(autoApprove);
  const finishedRef = useRef(false);
  const activityIdRef = useRef(0);
  const t = translations[language];

  const loadReports = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/reports`, {
        credentials: "include",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Could not load reports");
      const payload = (await response.json()) as {
        reports?: StoredReportSummary[];
      };
      setStoredReports(payload.reports || []);
    } catch {
      setStoredReports([]);
    }
  };

  useEffect(() => {
    window.localStorage.setItem("deep-research-language", language);
    const onLoginScreen = authStatus === "unauthenticated";
    document.documentElement.lang = onLoginScreen ? "en" : language;
    document.title = onLoginScreen
      ? "Nexora — AI research workspace"
      : t.documentTitle;
  }, [authStatus, language, t.documentTitle]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyAppearance = () => {
      document.documentElement.dataset.theme = appearance === "system"
        ? (media.matches ? "dark" : "light")
        : appearance;
      document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
    };
    applyAppearance();
    if (appearance === "system") media.addEventListener("change", applyAppearance);
    try { window.localStorage.setItem("deep-research-appearance", appearance); } catch { /* Storage may be blocked. */ }
    return () => media.removeEventListener("change", applyAppearance);
  }, [appearance]);

  useEffect(() => {
    window.localStorage.setItem(
      "deep-research-settings",
      JSON.stringify({ researchDepth, maxAnalysts, autoApprove }),
    );
  }, [researchDepth, maxAnalysts, autoApprove]);

  useEffect(() => {
    autoApproveRef.current = autoApprove;
  }, [autoApprove]);

  useEffect(() => {
    const syncRoute = () => {
      const infoView = informationViewFromHash();
      setInformationView(infoView);
      const routedView = routedViewFromHash();
      setProfileCompletion(profileCompletionFromHash(window.location.hash));
      if (routedView) setActiveView(routedView);
      else if (!infoView)
        setActiveView((current) =>
          current === "guide" || current === "pricing" || current === "profile" || current === "collab"
            ? "overview"
            : current,
        );
    };
    window.addEventListener("popstate", syncRoute);
    window.addEventListener("hashchange", syncRoute);
    return () => {
      window.removeEventListener("popstate", syncRoute);
      window.removeEventListener("hashchange", syncRoute);
    };
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !authUser || authUser.public_name?.trim() || activeView !== 'collab' || informationView) return;
    const setupHash = profileSetupHash({ returnHash: window.location.hash || '#/collab', field: collabField });
    const request = profileCompletionFromHash(setupHash);
    setProfileCompletion(request);
    setActiveView('profile');
    window.history.replaceState({}, '', `${window.location.pathname}${setupHash}`);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [authStatus, authUser, activeView, informationView, collabField]);

  useEffect(() => {
    let cancelled = false;
    const bootstrapAuth = async () => {
      const query = new URLSearchParams(window.location.search);
      const callbackError = query.get("auth_error");
      const callbackSuccess = query.get("auth") === "success";
      if (callbackError) setAuthError(callbackError);
      if (query.has("auth") || callbackError) {
        window.history.replaceState(
          {},
          "",
          `${window.location.pathname}${window.location.hash}`,
        );
      }

      try {
        const [providersResponse, meResponse] = await Promise.all([
          fetch(`${API_BASE}/api/auth/providers`, {
            credentials: "include",
            signal: AbortSignal.timeout(8000),
          }),
          fetch(`${API_BASE}/api/auth/me`, {
            credentials: "include",
            signal: AbortSignal.timeout(8000),
          }),
        ]);
        if (!providersResponse.ok || !meResponse.ok)
          throw new Error("Authentication service unavailable");
        const providerPayload = (await providersResponse.json()) as {
          providers?: { google?: boolean; github?: boolean };
          dev_login?: boolean;
        };
        const mePayload = (await meResponse.json()) as {
          authenticated?: boolean;
          user?: AuthUser | null;
        };
        if (cancelled) return;
        setAuthProviders({
          google: Boolean(providerPayload.providers?.google),
          github: Boolean(providerPayload.providers?.github),
          dev_login: Boolean(providerPayload.dev_login),
        });
        if (mePayload.authenticated && mePayload.user) {
          setAuthUser(mePayload.user);
          setAuthStatus("authenticated");
          if (callbackSuccess) setShowWelcome(true);
        } else {
          setAuthStatus("unauthenticated");
        }
      } catch {
        if (!cancelled) {
          setAuthStatus("unauthenticated");
          setAuthError(
            "Could not reach the sign-in service. Check the backend.",
          );
        }
      }
    };
    void bootstrapAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const checkHealth = async () => {
      setHealth("checking");
      try {
        const response = await fetch(`${API_BASE}/health`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) throw new Error("Backend unavailable");
        if (!cancelled) setHealth("online");
      } catch {
        if (!cancelled) setHealth("offline");
      }
    };
    void checkHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authStatus === "authenticated") void loadReports();
    if (authStatus === "unauthenticated") {
      setStoredReports([]);
      setSelectedReport(null);
    }
  }, [authStatus]);

  useEffect(() => {
    if (!showWelcome) return undefined;
    const timeout = window.setTimeout(() => setShowWelcome(false), 1750);
    return () => window.clearTimeout(timeout);
  }, [showWelcome]);

  useEffect(
    () => () => {
      socketRef.current?.close();
    },
    [],
  );

  const phaseIndex = phaseOrder.indexOf(phase);
  const isBusy = [
    "connecting",
    "running",
    "review_analysts",
    "review_sections",
  ].includes(status);
  const canStart = topic.trim().length >= 8 && !isBusy && health === "online";
  const activeTopic = topic.trim() || t.showcase.sampleTopic;
  const statusCopy = useMemo(() => t.status[status], [status, t]);
  const menuSourceCount = useMemo(
    () =>
      new Set(
        storedReports.flatMap((report) =>
          report.sources.map((source) => source.url.replace(/\/$/, "")),
        ),
      ).size,
    [storedReports],
  );

  const beginOAuth = (provider: "google" | "github", remember: boolean) => {
    setAuthError("");
    setAuthBusy(true);
    const query = new URLSearchParams({ remember: String(remember) });
    window.location.assign(
      `${API_BASE}/api/auth/login/${provider}?${query.toString()}`,
    );
  };

  const developmentLogin = async (remember: boolean) => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const query = new URLSearchParams({ remember: String(remember) });
      const response = await fetch(
        `${API_BASE}/api/auth/dev-login?${query.toString()}`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      if (!response.ok) throw new Error("Development login failed");
      const payload = (await response.json()) as { user: AuthUser };
      setAuthUser(payload.user);
      setAuthStatus("authenticated");
      setShowWelcome(true);
    } catch {
      setAuthError("Could not open the local development account.");
    } finally {
      setAuthBusy(false);
    }
  };

  const logout = async () => {
    finishedRef.current = true;
    socketRef.current?.close();
    socketRef.current = null;
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setAuthUser(null);
      setProfileCompletion(null);
      setProfileEditRequest(0);
      setAuthStatus("unauthenticated");
      setActiveView("overview");
      setStatus("idle");
    }
  };

  const navigateTo = (view: AppView) => {
    if (view === activeView && !informationView) return;
    const changeView = () => {
      setProfileCompletion(null);
      setProfileEditRequest(0);
      if (view !== 'collab') setCollabField(null);
      setInformationView(null);
      setActiveView(view);
      const route =
        view === "guide" || view === "pricing" || view === "profile" || view === "collab"
          ? `${window.location.pathname}#/${view}`
          : window.location.pathname;
      window.history.pushState({}, "", route);
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };
    const motionAllowed = !window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    const transitionDocument = document as Document & {
      startViewTransition?: (callback: () => void) => void;
    };
    if (motionAllowed && transitionDocument.startViewTransition) {
      transitionDocument.startViewTransition(changeView);
    } else {
      changeView();
    }
  };

  const navigateToInformation = (view: InformationView) => {
    if (view === informationView) return;
    const changeView = () => {
      setProfileCompletion(null);
      setProfileEditRequest(0);
      setInformationView(view);
      window.history.pushState({}, "", `${window.location.pathname}#/${view}`);
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };
    const motionAllowed = !window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    const transitionDocument = document as Document & {
      startViewTransition?: (callback: () => void) => void;
    };
    if (motionAllowed && transitionDocument.startViewTransition)
      transitionDocument.startViewTransition(changeView);
    else changeView();
  };

  const openProfileEditor = () => {
    // Keep this request in the same state transition; a deferred navigation
    // must not reset the request before the profile has mounted.
    setProfileCompletion(null);
    setCollabField(null);
    setInformationView(null);
    setActiveView('profile');
    setProfileEditRequest((value) => value + 1);
    window.history.pushState({}, '', `${window.location.pathname}#/profile`);
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const closeInformation = () => {
    const changeView = () => {
      setInformationView(null);
      window.history.pushState({}, "", window.location.pathname);
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };
    const transitionDocument = document as Document & {
      startViewTransition?: (callback: () => void) => void;
    };
    if (transitionDocument.startViewTransition)
      transitionDocument.startViewTransition(changeView);
    else changeView();
  };

  const resetBrowserPreferences = () => {
    window.localStorage.removeItem("deep-research-language");
    window.localStorage.removeItem("deep-research-settings");
    window.localStorage.removeItem("deep-research-active-domain");
    window.localStorage.removeItem("deep-research-domain-workspace");
    window.localStorage.removeItem("deep-research-guide-progress");
    window.localStorage.removeItem("deep-research-plan-interest");
    window.localStorage.removeItem("deep-research-appearance");
    setAppearance("system");
    setLanguage("en");
    setResearchDepth("standard");
    setMaxAnalysts(2);
    setAutoApprove(true);
    setNotice(
      language === "vi"
        ? "Đã đặt lại tùy chọn trình duyệt."
        : "Browser preferences reset to defaults.",
    );
    window.setTimeout(() => setNotice(""), 2600);
  };

  const pushActivity = (label: string, detail?: string) => {
    activityIdRef.current += 1;
    setActivities((current) => [
      ...current,
      { id: activityIdRef.current, label, detail, time: nowLabel(language) },
    ]);
  };

  const sendApproval = (value = "approve") => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        event: "feedback_submit",
        feedback: value || "approve",
      }),
    );
    setFeedback("");
    setStatus("running");
    pushActivity(
      value === "approve" ? t.activity.approved : t.activity.revisionSent,
    );
  };

  const handleMessage = (message: ServerMessage) => {
    switch (message.event) {
      case "node_complete": {
        const node = message.node as NodeKey | undefined;
        const knownNode = node && node in nodePhases ? node : undefined;
        setPhase(knownNode ? nodePhases[knownNode] : phase);
        pushActivity(
          knownNode ? t.nodes[knownNode] : message.node || t.activity.unknown,
        );
        break;
      }
      case "analysts_generated":
        setAnalysts(message.analysts || []);
        setPhase("analysts");
        if (!autoApproveRef.current) setStatus("review_analysts");
        break;
      case "sections_completed":
        setSections(message.sections || []);
        setPhase("synthesis");
        if (!autoApproveRef.current) setStatus("review_sections");
        break;
      case "feedback_requested":
        if (autoApproveRef.current) {
          sendApproval("approve");
        } else if (message.interrupt_type === "human_feedback") {
          setStatus("review_analysts");
        } else {
          setStatus("review_sections");
        }
        break;
      case "report_complete":
        finishedRef.current = true;
        setFinalReport(message.final_report || "");
        setServerPath(message.filepath || "");
        setSourceCount(message.source_count || 0);
        setAuditNotes(message.audit_notes || "");
        setPhase("done");
        setStatus("completed");
        pushActivity(t.activity.completed);
        void loadReports();
        break;
      case "error":
        finishedRef.current = true;
        setErrorMessage(message.details || message.message || t.errors.unknown);
        setStatus("error");
        break;
      default:
        break;
    }
  };

  const startResearch = () => {
    if (!canStart) return;
    socketRef.current?.close();
    finishedRef.current = false;
    setStatus("connecting");
    setPhase("setup");
    setAnalysts([]);
    setSections([]);
    setActivities([]);
    setFinalReport("");
    setServerPath("");
    setSourceCount(0);
    setAuditNotes("");
    setErrorMessage("");
    setNotice("");

    const socket = new WebSocket(buildWebSocketUrl());
    socketRef.current = socket;

    socket.onopen = () => {
      setStatus("running");
      socket.send(
        JSON.stringify({
          event: "start_research",
          topic: topic.trim(),
          max_analysts: maxAnalysts,
          report_language: language,
          research_depth: researchDepth,
          research_domain: researchContext?.domain || "general",
          research_category: researchContext?.category || "",
          research_notes: researchContext?.researchNotes || "",
          latex_context: researchContext?.latexContext || "",
          source_preferences: researchContext?.sourcePreferences || [],
          user_id: "web-user",
        }),
      );
    };

    socket.onmessage = (event) => {
      try {
        handleMessage(JSON.parse(event.data) as ServerMessage);
      } catch {
        setErrorMessage(t.errors.invalidResponse);
        setStatus("error");
      }
    };

    socket.onerror = () => {
      setErrorMessage(t.errors.websocket);
      setStatus("error");
    };

    socket.onclose = () => {
      if (!finishedRef.current && socketRef.current === socket) {
        setErrorMessage(t.errors.closed);
        setStatus("error");
      }
    };
  };

  const cancelResearch = () => {
    finishedRef.current = true;
    socketRef.current?.close();
    socketRef.current = null;
    setStatus("idle");
    setPhase("setup");
    pushActivity(t.activity.cancelled);
  };

  const startOver = () => {
    finishedRef.current = true;
    socketRef.current?.close();
    socketRef.current = null;
    setStatus("idle");
    setPhase("setup");
    setTopic("");
    setResearchContext(null);
    setFinalReport("");
    setServerPath("");
    setSourceCount(0);
    setAuditNotes("");
    setActivities([]);
    setAnalysts([]);
    setSections([]);
    setErrorMessage("");
    setFeedback("");
  };

  const downloadReport = () => {
    const blob = new Blob([finalReport], {
      type: "text/markdown;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${language === "vi" ? "nghien-cuu" : "research"}-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const copyReport = async () => {
    await navigator.clipboard.writeText(finalReport);
    setNotice(t.workspace.copied);
    window.setTimeout(() => setNotice(""), 2200);
  };

  const openResearch = (suggestedTopic?: string) => {
    if (isBusy) {
      navigateTo("research");
      return;
    }
    if (
      suggestedTopic !== undefined ||
      status === "completed" ||
      status === "error"
    ) {
      startOver();
    }
    if (suggestedTopic) setTopic(suggestedTopic);
    navigateTo("research");
  };

  const openDomainResearch = (payload: DomainResearchPayload) => {
    if (isBusy) {
      setNotice(
        language === "vi"
          ? "Hãy hoàn tất hoặc dừng phiên đang chạy trước."
          : "Finish or stop the active session first.",
      );
      window.setTimeout(() => setNotice(""), 2600);
      navigateTo("research");
      return;
    }
    startOver();
    setResearchContext(payload);
    setTopic(payload.topic);
    navigateTo("research");
    setNotice(
      language === "vi"
        ? "Đã áp dụng context lĩnh vực vào brief."
        : "Field context added to the brief.",
    );
    window.setTimeout(() => setNotice(""), 2200);
  };

  const openStoredReport = async (report: StoredReportSummary) => {
    navigateTo("reports");
    setLibraryLoading(true);
    try {
      const response = await fetch(
        `${API_BASE}/api/reports/${encodeURIComponent(report.id)}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Report not found");
      setSelectedReport((await response.json()) as StoredReportDetail);
    } catch {
      setSelectedReport(null);
      setNotice(
        language === "vi"
          ? "Không thể mở báo cáo."
          : "Could not open the report.",
      );
      window.setTimeout(() => setNotice(""), 2200);
    } finally {
      setLibraryLoading(false);
    }
  };

  const deleteStoredReport = async (report: StoredReportSummary) => {
    const confirmed = window.confirm(
      language === "vi"
        ? `Xóa vĩnh viễn báo cáo “${report.title}”?`
        : `Permanently delete “${report.title}”?`,
    );
    if (!confirmed) return;
    const response = await fetch(
      `${API_BASE}/api/reports/${encodeURIComponent(report.id)}`,
      { method: "DELETE", credentials: "include" },
    );
    if (!response.ok) {
      setNotice(
        language === "vi"
          ? "Không thể xóa báo cáo."
          : "Could not delete the report.",
      );
      return;
    }
    if (selectedReport?.id === report.id) setSelectedReport(null);
    await loadReports();
    setNotice(language === "vi" ? "Đã xóa báo cáo." : "Report deleted.");
    window.setTimeout(() => setNotice(""), 2200);
  };

  const copyStoredReport = async (report: StoredReportDetail) => {
    await navigator.clipboard.writeText(report.final_report);
    setNotice(t.workspace.copied);
    window.setTimeout(() => setNotice(""), 2200);
  };

  const downloadStoredReport = (report: StoredReportDetail) => {
    const blob = new Blob([report.final_report], {
      type: "text/markdown;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = report.id;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const exportWorkspace = async () => {
    const details = await Promise.all(
      storedReports.map(async (report) => {
        try {
          const response = await fetch(
            `${API_BASE}/api/reports/${encodeURIComponent(report.id)}`,
            { credentials: "include" },
          );
          return response.ok
            ? ((await response.json()) as StoredReportDetail)
            : report;
        } catch {
          return report;
        }
      }),
    );
    const backup = {
      exported_at: new Date().toISOString(),
      settings: { language, researchDepth, maxAnalysts, autoApprove },
      reports: details,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `deep-research-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const flowIcons = [Search, Users, Database, FileText];

  if (authStatus === "checking") {
    return (
      <div className="auth-loading-screen" role="status">
        <span>
          <BrandMark size={46} />
        </span>
        <strong>Nexora</strong>
        <LoaderCircle className="spin" size={20} />
      </div>
    );
  }

  if (authStatus === "unauthenticated" || !authUser) {
    if (informationView) {
      return (
        <div className="public-info-shell">
          <PublicInformationHeader language="en" onBack={closeInformation} />
          <main className="product-page information-page-shell view-enter">
            <InformationPage
              view={informationView}
              language="en"
              health={health}
              publicMode
              onBack={closeInformation}
              onNavigate={() => closeInformation()}
              onNavigateInformation={navigateToInformation}
            />
          </main>
          <PublicInformationFooter
            language="en"
            onNavigateInformation={navigateToInformation}
          />
        </div>
      );
    }
    return (
      <LoginPage
        providers={authProviders}
        busy={authBusy}
        error={authError}
        onOAuth={beginOAuth}
        onDevelopmentLogin={(remember) => void developmentLogin(remember)}
        onOpenInformation={navigateToInformation}
      />
    );
  }

  return (
    <div className="app-shell app-shell--ready">
      {showWelcome && <WelcomeTransition user={authUser} language={language} />}
      <header className="topbar">
        <button
          className="brand brand-button"
          type="button"
          onClick={() => navigateTo("overview")}
        >
          <div className="brand-mark">
            <BrandMark size={40} />
          </div>
          <div>
            <strong>Nexora</strong>
            <span>{t.brandSubtitle}</span>
          </div>
        </button>
        <div className="topbar-actions">
          <div
            className="language-switch"
            role="group"
            aria-label={t.languageLabel}
          >
            <Globe2 size={17} aria-hidden="true" />
            {(["vi", "en"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={language === item ? "is-active" : ""}
                aria-pressed={language === item}
                disabled={isBusy}
                onClick={() => setLanguage(item)}
              >
                {item === "vi" ? "VIE" : "ENG"}
              </button>
            ))}
          </div>
          <UserMenu
            user={authUser}
            language={language}
            appearance={appearance}
            onAppearanceChange={setAppearance}
            reportCount={storedReports.length}
            sourceCount={menuSourceCount}
            onNavigate={navigateTo}
            onLogout={() => void logout()}
            onOpenTour={() => setTourRequest('catalog')}
          />
        </div>
      </header>
      <ProductNavigation
        language={language}
        activeView={informationView ? null : activeView}
        reportCount={storedReports.length}
        onNavigate={(view) => { if (view === 'collab') setCollabField(null); navigateTo(view); }}
      />

      {informationView ? (
        <main
          className="product-page information-page-shell view-enter"
          key={informationView}
        >
          <InformationPage
            view={informationView}
            language={language}
            health={health}
            onBack={closeInformation}
            onNavigate={navigateTo}
            onNavigateInformation={navigateToInformation}
            onResetPreferences={resetBrowserPreferences}
          />
        </main>
      ) : activeView === "guide" ? (
        <main
          className="product-page learning-page-shell view-enter"
          key="guide"
        >
          <Suspense
            fallback={
              <div className="domain-loading" role="status">
                <LoaderCircle className="spin" size={24} />
                <span>
                  {language === "vi" ? "Đang mở hướng dẫn…" : "Opening guide…"}
                </span>
              </div>
            }
          >
            <GuidePage
              language={language}
              onNavigate={navigateTo}
              onOpenTour={() => setTourRequest('catalog')}
            />
          </Suspense>
        </main>
      ) : activeView === "pricing" ? (
        <main
          className="product-page learning-page-shell view-enter"
          key="pricing"
        >
          <Suspense
            fallback={
              <div className="domain-loading" role="status">
                <LoaderCircle className="spin" size={24} />
                <span>
                  {language === "vi" ? "Đang mở bảng giá…" : "Opening pricing…"}
                </span>
              </div>
            }
          >
            <PricingPage
              language={language}
              user={authUser}
              onNavigate={navigateTo}
              onNotify={(message) => {
                setNotice(message);
                window.setTimeout(() => setNotice(""), 2600);
              }}
            />
          </Suspense>
        </main>
      ) : activeView === "profile" || (activeView === 'collab' && !authUser.public_name?.trim()) ? (
        <main
          className="product-page profile-page-shell view-enter"
          key="profile"
        >
          <Suspense
            fallback={
              <div className="domain-loading" role="status">
                <LoaderCircle className="spin" size={24} />
                <span>
                  {language === "vi" ? "Đang mở hồ sơ…" : "Opening profile…"}
                </span>
              </div>
            }
          >
            <UserProfile
              apiBase={API_BASE}
              language={language}
              user={authUser}
              reports={storedReports}
              nameRequired={Boolean(profileCompletion) || activeView === 'collab'}
              editRequest={profileEditRequest}
              onNavigate={navigateTo}
              onOpenReport={(report) => void openStoredReport(report)}
              onUserUpdate={(updated) => {
                setAuthUser(updated);
                if (profileCompletion && updated.public_name?.trim()) {
                  setCollabField(profileCompletion.field);
                  setActiveView('collab');
                  setInformationView(null);
                  window.history.replaceState({}, '', `${window.location.pathname}${profileCompletion.returnHash}`);
                  setProfileCompletion(null);
                  setProfileEditRequest(0);
                  window.scrollTo({ top: 0, behavior: 'auto' });
                }
              }}
              onNotify={(message) => {
                setNotice(message);
                window.setTimeout(() => setNotice(""), 2600);
              }}
            />
          </Suspense>
        </main>
      ) : activeView === "research" ? (
        <main className="workspace view-enter" key="research">
          <section className="showcase-panel">
            <div className="showcase-grid" aria-hidden="true" />
            <div className="showcase-content">
              <span className="engine-badge">
                <Cpu size={15} />
                {t.showcase.badge}
              </span>
              <h1>{t.showcase.title}</h1>
              <p>{t.showcase.description}</p>

              <article className="flow-card">
                <div className="flow-card__header">
                  <span>
                    <span className="live-dot" />
                    {t.showcase.cardTitle}
                  </span>
                  <strong>{t.showcase.cardBadge}</strong>
                </div>
                <div className="flow-topic">
                  <span>{t.showcase.topicLabel}</span>
                  <strong>{activeTopic}</strong>
                </div>
                <div className="flow-steps">
                  {t.showcase.steps.map((step, index) => {
                    const Icon = flowIcons[index];
                    return (
                      <div key={step}>
                        <span>
                          <Icon size={17} />
                        </span>
                        <small>0{index + 1}</small>
                        <strong>{step}</strong>
                        {index < t.showcase.steps.length - 1 && (
                          <ArrowRight size={14} />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flow-metrics">
                  {t.showcase.metrics.map((metric) => (
                    <div key={metric.label}>
                      <strong>{metric.value}</strong>
                      <span>{metric.label}</span>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <div className="assurance-grid">
              {t.showcase.assurances.map((item, index) => {
                const Icon = [ShieldCheck, Zap, Cpu][index];
                return (
                  <span key={item}>
                    <Icon size={17} />
                    {item}
                  </span>
                );
              })}
            </div>
          </section>

          <section className="app-panel">
            <aside className="control-panel">
              <div className="panel-heading">
                <span className="eyebrow">{t.brief.eyebrow}</span>
                <h2>{t.brief.title}</h2>
                <p>{t.brief.description}</p>
              </div>

              {researchContext && (
                <div className="research-context-card">
                  <span>
                    <Shapes size={18} />
                  </span>
                  <div>
                    <small>
                      {language === "vi"
                        ? "RESEARCH CONTEXT"
                        : "RESEARCH CONTEXT"}
                    </small>
                    <strong>
                      {researchContext.domainLabel} ·{" "}
                      {researchContext.categoryLabel}
                    </strong>
                    <p>
                      {language === "vi"
                        ? `${researchContext.sourcePreferences.length} nhóm nguồn ưu tiên${researchContext.researchNotes ? " · có notebook" : ""}${researchContext.latexContext ? " · có LaTeX" : ""}`
                        : `${researchContext.sourcePreferences.length} source lanes${researchContext.researchNotes ? " · notebook attached" : ""}${researchContext.latexContext ? " · LaTeX attached" : ""}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={
                      language === "vi"
                        ? "Xóa context lĩnh vực"
                        : "Clear field context"
                    }
                    disabled={isBusy}
                    onClick={() => setResearchContext(null)}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}

              <label className="field-label" htmlFor="topic">
                {t.brief.topicLabel}
              </label>
              <div className="topic-field" data-tour="research-topic">
                <textarea
                  id="topic"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder={t.brief.placeholder}
                  rows={6}
                  disabled={isBusy}
                />
                <span className="character-count">
                  {topic.trim().length} {t.brief.characters}
                </span>
              </div>

              {status === "idle" && !topic && (
                <div className="idea-list" aria-label={t.brief.suggestions}>
                  <span>{t.brief.suggestions}</span>
                  {t.brief.topics.map((idea) => (
                    <button
                      key={idea}
                      type="button"
                      onClick={() => setTopic(idea)}
                    >
                      {idea}
                      <ArrowRight size={14} />
                    </button>
                  ))}
                </div>
              )}

              <div className="depth-section" data-tour="research-depth">
                <div className="depth-heading">
                  <span className="field-label">{t.brief.depthLabel}</span>
                  <small>{t.brief.depthDescription}</small>
                </div>
                <div
                  className="depth-grid"
                  role="radiogroup"
                  aria-label={t.brief.depthLabel}
                >
                  {depthOrder.map((depth) => {
                    const option = t.brief.depthOptions[depth];
                    return (
                      <button
                        key={depth}
                        type="button"
                        role="radio"
                        aria-checked={researchDepth === depth}
                        className={
                          researchDepth === depth
                            ? "depth-option is-active"
                            : "depth-option"
                        }
                        disabled={isBusy}
                        onClick={() => {
                          setResearchDepth(depth);
                          setMaxAnalysts(depth === "quick" ? 1 : 2);
                        }}
                      >
                        <span>
                          <strong>{option.title}</strong>
                          {depth === "deep" && <Sparkles size={13} />}
                        </span>
                        <small>{option.description}</small>
                        <em>{option.meta}</em>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="settings-grid" data-tour="research-options">
                <div>
                  <label className="field-label" htmlFor="analysts">
                    {t.brief.analystsLabel}
                  </label>
                  <div className="select-wrap">
                    <select
                      id="analysts"
                      value={maxAnalysts}
                      onChange={(event) =>
                        setMaxAnalysts(Number(event.target.value))
                      }
                      disabled={isBusy}
                    >
                      {t.brief.analystOptions.map((option, index) => (
                        <option key={option} value={index + 1}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={16} aria-hidden="true" />
                  </div>
                </div>
                <label className="switch-row">
                  <span>
                    <strong>{t.brief.autoApprove}</strong>
                    <small>{t.brief.autoApproveHint}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={autoApprove}
                    onChange={(event) => setAutoApprove(event.target.checked)}
                    disabled={isBusy}
                  />
                  <span className="switch" aria-hidden="true" />
                </label>
              </div>

              {researchDepth === "deep" && (
                <div className="quota-note">
                  <AlertCircle size={17} />
                  <span>{t.brief.quotaWarning}</span>
                </div>
              )}

              <div className="primary-actions" data-tour="research-launch">
                {!isBusy ? (
                  <button
                    className="button button--primary"
                    type="button"
                    disabled={!canStart}
                    onClick={startResearch}
                  >
                    <Sparkles size={18} />
                    {status === "completed" ? t.brief.restart : t.brief.start}
                  </button>
                ) : (
                  <button
                    className="button button--stop"
                    type="button"
                    onClick={cancelResearch}
                  >
                    <Square size={16} />
                    {t.brief.stop}
                  </button>
                )}
                {health === "offline" && (
                  <p className="inline-error">{t.brief.backendHint}</p>
                )}
              </div>

              <div className="model-note">
                <Bot size={17} />
                <span>{t.brief.modelNote}</span>
              </div>
            </aside>

            <section className="stage" aria-live="polite">
              <div className="stage-header">
                <div>
                  <span className="eyebrow">{t.workspace.eyebrow}</span>
                  <h2>{statusCopy}</h2>
                </div>
                {status === "completed" && (
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={startOver}
                  >
                    <RefreshCw size={16} />
                    {t.workspace.newTopic}
                  </button>
                )}
              </div>

              <ol
                className="progress-rail"
                aria-label={t.workspace.progressLabel}
              >
                {phaseOrder.map((item, index) => {
                  const isComplete = index < phaseIndex || phase === "done";
                  const isActive = index === phaseIndex && phase !== "done";
                  return (
                    <li
                      key={item}
                      className={
                        isComplete ? "is-complete" : isActive ? "is-active" : ""
                      }
                    >
                      <span className="progress-dot">
                        {isComplete ? <Check size={14} /> : index + 1}
                      </span>
                      <span>
                        <strong>{t.phases[item].label}</strong>
                        <small>{t.phases[item].caption}</small>
                      </span>
                    </li>
                  );
                })}
              </ol>

              {status === "idle" && !finalReport && (
                <div className="empty-state">
                  <div className="empty-visual" aria-hidden="true">
                    <div className="source-node source-node--web">
                      <Search size={18} />
                    </div>
                    <div className="source-node source-node--agent">
                      <Bot size={20} />
                    </div>
                    <div className="source-node source-node--report">
                      <FileText size={18} />
                    </div>
                    <span className="connection-line connection-line--one" />
                    <span className="connection-line connection-line--two" />
                  </div>
                  <h3>{t.workspace.emptyTitle}</h3>
                  <p>{t.workspace.emptyDescription}</p>
                  <div className="empty-facts">
                    <span>
                      <Users size={16} />
                      {t.workspace.facts[0]}
                    </span>
                    <span>
                      <Search size={16} />
                      {t.workspace.facts[1]}
                    </span>
                    <span>
                      <BookOpen size={16} />
                      {t.workspace.facts[2]}
                    </span>
                  </div>
                </div>
              )}

              {(status === "connecting" || status === "running") && (
                <div className="running-view">
                  <div className="running-orbit" aria-hidden="true">
                    <span className="orbit orbit--outer" />
                    <span className="orbit orbit--inner" />
                    <div className="orbit-core">
                      <LoaderCircle size={27} />
                    </div>
                  </div>
                  <div>
                    <h3>{t.phases[phase].label}</h3>
                    <p>
                      {t.phases[phase].caption}. {t.workspace.runningSuffix}
                    </p>
                  </div>
                </div>
              )}

              {status === "review_analysts" && (
                <div className="review-card">
                  <div className="review-heading">
                    <div className="review-icon">
                      <Users size={20} />
                    </div>
                    <div>
                      <h3>{t.workspace.analystReviewTitle}</h3>
                      <p>{t.workspace.analystReviewDescription}</p>
                    </div>
                  </div>
                  <div className="analyst-list">
                    {analysts.map((analyst, index) => (
                      <article
                        key={`${analyst.name}-${index}`}
                        className="analyst-card"
                      >
                        <span className="analyst-index">0{index + 1}</span>
                        <div>
                          <h4>{analyst.name}</h4>
                          <span>
                            {analyst.role} · {analyst.affiliation}
                          </span>
                          <p>{analyst.description}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                  <FeedbackComposer
                    value={feedback}
                    onChange={setFeedback}
                    onApprove={() => sendApproval("approve")}
                    onSubmit={() => sendApproval(feedback)}
                    placeholder={t.workspace.analystFeedback}
                    ariaLabel={t.workspace.feedbackLabel}
                    submitLabel={t.workspace.submitFeedback}
                    approveLabel={t.workspace.approve}
                  />
                </div>
              )}

              {status === "review_sections" && (
                <div className="review-card">
                  <div className="review-heading">
                    <div className="review-icon">
                      <FileText size={20} />
                    </div>
                    <div>
                      <h3>{t.workspace.sectionReviewTitle}</h3>
                      <p>{t.workspace.sectionReviewDescription}</p>
                    </div>
                  </div>
                  <div className="section-list">
                    {sections.map((section, index) => (
                      <div key={`${section}-${index}`}>
                        <CheckCircle2 size={18} />
                        <span>
                          {section.replace(/^#+\s*/, "") ||
                            `Section ${index + 1}`}
                        </span>
                      </div>
                    ))}
                  </div>
                  <FeedbackComposer
                    value={feedback}
                    onChange={setFeedback}
                    onApprove={() => sendApproval("approve")}
                    onSubmit={() => sendApproval(feedback)}
                    placeholder={t.workspace.sectionFeedback}
                    ariaLabel={t.workspace.feedbackLabel}
                    submitLabel={t.workspace.submitFeedback}
                    approveLabel={t.workspace.approve}
                  />
                </div>
              )}

              {status === "error" && (
                <div className="error-state" role="alert">
                  <div>
                    <AlertCircle size={24} />
                  </div>
                  <h3>{t.workspace.errorTitle}</h3>
                  <p>{errorMessage}</p>
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={startOver}
                  >
                    <RefreshCw size={16} />
                    {t.workspace.retry}
                  </button>
                </div>
              )}

              {status === "completed" && finalReport && (
                <div className="report-view">
                  <div className="report-toolbar">
                    <div className="report-status">
                      <CheckCircle2 size={18} />
                      <span>
                        {serverPath
                          ? t.workspace.reportSaved
                          : t.workspace.reportReady}
                      </span>
                      {sourceCount > 0 && (
                        <small>
                          {sourceCount} {t.workspace.sourcesUsed}
                        </small>
                      )}
                      {auditNotes && researchDepth === "deep" && (
                        <small>{t.workspace.audited}</small>
                      )}
                    </div>
                    <div>
                      <button
                        className="icon-button"
                        type="button"
                        onClick={copyReport}
                        aria-label={t.workspace.copyReport}
                      >
                        <Clipboard size={17} />
                      </button>
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={downloadReport}
                      >
                        <Download size={16} />
                        {t.workspace.download}
                      </button>
                    </div>
                  </div>
                  <article className="report-paper">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ children, ...props }) => (
                          <a {...props} target="_blank" rel="noreferrer">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {finalReport}
                    </ReactMarkdown>
                  </article>
                </div>
              )}

              {activities.length > 0 && status !== "completed" && (
                <details className="activity-log" open={status === "running"}>
                  <summary>
                    <span>{t.workspace.recentActivity}</span>
                    <span>
                      {activities.length} {t.workspace.steps}
                    </span>
                  </summary>
                  <div>
                    {[...activities].reverse().map((item) => (
                      <div className="activity-row" key={item.id}>
                        <span className="activity-check">
                          <Check size={12} />
                        </span>
                        <span>
                          <strong>{item.label}</strong>
                          {item.detail && <small>{item.detail}</small>}
                        </span>
                        <time>{item.time}</time>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </section>
          </section>
        </main>
      ) : activeView === "domains" ? (
        <main className="product-page domain-page view-enter" key="domains">
          <Suspense
            fallback={
              <div className="domain-loading" role="status">
                <LoaderCircle className="spin" size={24} />
                <span>
                  {language === "vi"
                    ? "Đang mở bộ công cụ lĩnh vực…"
                    : "Opening field toolkit…"}
                </span>
              </div>
            }
          >
            <DomainHub
              language={language}
              onStartResearch={openDomainResearch}
              onOpenNotebook={(field) => { setCollabField(field); navigateTo('collab'); }}
            />
          </Suspense>
        </main>
      ) : activeView === "collab" ? (
        <main className="product-page collab-page-shell view-enter" key="collab">
          <Suspense fallback={<div className="domain-loading" role="status"><LoaderCircle className="spin" size={24} />{language === 'vi' ? 'Đang mở dự án…' : 'Opening projects…'}</div>}>
            <CollaborationHub apiBase={API_BASE} language={language} user={authUser} reports={storedReports} initialField={collabField} onEditProfile={openProfileEditor} onPrepareResearch={openDomainResearch} />
          </Suspense>
        </main>
      ) : activeView === "admin" && authUser.role === "admin" ? (
        <main className="product-page admin-page view-enter" key="admin">
          <AdminConsole
            apiBase={API_BASE}
            language={language}
            currentUser={authUser}
            onNotify={(message) => {
              setNotice(message);
              window.setTimeout(() => setNotice(""), 2600);
            }}
          />
        </main>
      ) : (
        <main className="product-page view-enter" key={activeView}>
          <WorkspaceHub
            key={activeView === 'reports' ? `reports-${libraryTourReset}` : activeView}
            apiBase={API_BASE}
            view={
              activeView as Exclude<
                AppView,
                | "research"
                | "domains"
                | "collab"
                | "guide"
                | "pricing"
                | "profile"
                | "admin"
              >
            }
            language={language}
            reports={storedReports}
            selectedReport={selectedReport}
            loading={libraryLoading}
            health={health}
            researchDepth={researchDepth}
            maxAnalysts={maxAnalysts}
            autoApprove={autoApprove}
            onStartTopic={openResearch}
            onOpenReport={(report) => void openStoredReport(report)}
            onDeleteReport={(report) => void deleteStoredReport(report)}
            onCopyReport={(report) => void copyStoredReport(report)}
            onDownloadReport={downloadStoredReport}
            onLanguageChange={setLanguage}
            onDepthChange={(depth) => {
              setResearchDepth(depth);
              if (depth === "quick") setMaxAnalysts(1);
            }}
            onAnalystsChange={setMaxAnalysts}
            onAutoApproveChange={setAutoApprove}
            onRefresh={() => void loadReports()}
            onExport={() => void exportWorkspace()}
          />
        </main>
      )}

      <AppFooter
        language={language}
        health={health}
        onNavigate={navigateTo}
        onNavigateInformation={navigateToInformation}
      />

      {!informationView && <Suspense fallback={null}><GuidedTour
        apiBase={API_BASE}
        user={authUser}
        language={language}
        activeView={activeView}
        showWelcome={showWelcome}
        request={tourRequest}
        clearRequest={() => setTourRequest(null)}
        onNavigate={navigateTo}
        onResetLibrary={() => setLibraryTourReset((value) => value + 1)}
      /></Suspense>}

      {notice && (
        <div className="toast" role="status">
          <Check size={15} />
          {notice}
        </div>
      )}
    </div>
  );
}

interface FeedbackComposerProps {
  value: string;
  placeholder: string;
  ariaLabel: string;
  submitLabel: string;
  approveLabel: string;
  onChange: (value: string) => void;
  onApprove: () => void;
  onSubmit: () => void;
}

function FeedbackComposer({
  value,
  placeholder,
  ariaLabel,
  submitLabel,
  approveLabel,
  onChange,
  onApprove,
  onSubmit,
}: FeedbackComposerProps) {
  return (
    <div className="feedback-composer">
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        aria-label={ariaLabel}
      />
      <div>
        <button
          className="button button--secondary"
          type="button"
          disabled={!value.trim()}
          onClick={onSubmit}
        >
          <Send size={16} />
          {submitLabel}
        </button>
        <button
          className="button button--primary"
          type="button"
          onClick={onApprove}
        >
          <Check size={17} />
          {approveLabel}
        </button>
      </div>
    </div>
  );
}
