import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  BookOpenCheck,
  Check,
  CircleDollarSign,
  Clipboard,
  Database,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Gauge,
  Globe2,
  LayoutDashboard,
  LibraryBig,
  Link2,
  Shapes,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import type { ResearchReportData } from './ResearchEvidence';
import { LibraryLanding } from './LibraryLanding';
import type { ScholarlyFieldId } from './ScholarlyCatalog';

const PaperLibrary = lazy(() => import('./PaperLibrary').then((module) => ({ default: module.PaperLibrary })));
const ResearchEvidence = lazy(() => import('./ResearchEvidence').then((module) => ({ default: module.ResearchEvidence })));
const ReportMarkdown = lazy(() => import('./ReportMarkdown').then((module) => ({ default: module.ReportMarkdown })));

export type Language = 'vi' | 'en';
export type ResearchDepth = 'quick' | 'standard' | 'deep';
export type AppView = 'overview' | 'research' | 'domains' | 'reports' | 'sources' | 'collab' | 'settings' | 'guide' | 'pricing' | 'profile' | 'admin';
type PrimaryNavView = Exclude<AppView, 'profile'>;
export type Health = 'checking' | 'online' | 'offline';

export interface StoredSource {
  id: string;
  title: string;
  url: string;
  source_type: string;
  quality: string;
}

export interface StoredReportSummary {
  id: string;
  title: string;
  created_at: string;
  size_bytes: number;
  source_count: number;
  research_depth: ResearchDepth;
  research_domain?: string;
  research_category?: string;
  language: Language;
  sources: StoredSource[];
}

export interface StoredReportDetail extends StoredReportSummary {
  final_report: string;
  report_data?: ResearchReportData | null;
}

const copy = {
  vi: {
    nav: {
      overview: 'Tổng quan',
      research: 'Nghiên cứu',
      domains: 'Lĩnh vực',
      reports: 'Thư viện',
      sources: 'Kho nguồn',
      collab: 'Dự án',
      settings: 'Cài đặt',
      guide: 'Hướng dẫn',
      pricing: 'Bảng giá',
      admin: 'Host Console',
    },
    common: {
      newResearch: 'Nghiên cứu mới',
      open: 'Mở báo cáo',
      empty: 'Chưa có dữ liệu',
      quick: 'Nhanh', standard: 'Tiêu chuẩn', deep: 'Chuyên sâu',
      high: 'Cao', medium: 'Trung bình', low: 'Thấp',
    },
    overview: {
      eyebrow: 'Research command center',
      title: 'Mọi nghiên cứu trong một không gian.',
      description: 'Theo dõi thư viện, nguồn đã dùng và bắt đầu một brief mới mà không làm mất lịch sử cũ.',
      stats: ['Báo cáo đã lưu', 'Nguồn duy nhất', 'Phiên chuyên sâu', 'Nguồn chất lượng cao'],
      recent: 'Báo cáo gần đây',
      recentHint: 'Các kết quả được đọc trực tiếp từ thư mục reports.',
      templates: 'Brief gợi ý',
      templatesHint: 'Chọn một khung để đưa thẳng vào workspace.',
      noReports: 'Chưa có báo cáo nào. Bắt đầu phiên đầu tiên để xây thư viện.',
      templateItems: [
        { title: 'Khung quyết định công nghệ', topic: 'Xây dựng khung quyết định có số liệu để lựa chọn công nghệ phù hợp cho doanh nghiệp vừa và nhỏ tại Việt Nam' },
        { title: 'Phân tích thị trường', topic: 'Phân tích quy mô, động lực tăng trưởng, đối thủ và rủi ro của thị trường AI tạo sinh tại Việt Nam đến năm 2028' },
        { title: 'Đánh giá sản phẩm', topic: 'So sánh chuyên sâu các giải pháp trợ lý AI nội bộ theo chi phí, bảo mật, chất lượng và khả năng triển khai thực tế' },
      ],
    },
    reports: {
      eyebrow: 'Report library',
      title: 'Thư viện báo cáo',
      description: 'Tìm, lọc, đọc lại và tải xuống các nghiên cứu đã hoàn thành.',
      search: 'Tìm theo tiêu đề...',
      allDepths: 'Tất cả độ sâu',
      allDomains: 'Tất cả lĩnh vực',
      results: 'kết quả',
      selectTitle: 'Chọn một báo cáo để đọc',
      selectDescription: 'Nội dung đầy đủ và các thao tác sẽ xuất hiện tại đây.',
      copy: 'Sao chép',
      download: 'Tải PDF',
      delete: 'Xóa báo cáo',
      sources: 'nguồn',
    },
    sources: {
      eyebrow: 'Evidence catalog',
      title: 'Kho nguồn nghiên cứu',
      description: 'Tập hợp nguồn thật đã xuất hiện trong các báo cáo, kèm chất lượng và nơi đã sử dụng.',
      search: 'Tìm tên nguồn hoặc domain...',
      allQuality: 'Tất cả chất lượng',
      source: 'Nguồn',
      type: 'Loại',
      quality: 'Chất lượng',
      usedIn: 'Được dùng trong',
      noSources: 'Chưa tìm thấy nguồn phù hợp với bộ lọc.',
    },
    settings: {
      eyebrow: 'Workspace preferences',
      title: 'Cài đặt nghiên cứu',
      description: 'Các lựa chọn này được lưu trên trình duyệt và dùng làm mặc định cho phiên tiếp theo.',
      language: 'Ngôn ngữ mặc định',
      depth: 'Độ sâu mặc định',
      analysts: 'Số analyst mặc định',
      approval: 'Tự động duyệt',
      approvalHint: 'Cho phép pipeline chạy xuyên suốt mà không chờ feedback.',
      connection: 'Trạng thái hệ thống',
      online: 'Backend đang hoạt động',
      offline: 'Backend chưa kết nối',
      checking: 'Đang kiểm tra backend',
      data: 'Dữ liệu workspace',
      dataHint: 'Làm mới thư viện từ ổ đĩa hoặc xuất bản sao JSON để lưu trữ.',
      refresh: 'Làm mới thư viện',
      export: 'Xuất bản sao',
      saved: 'Tự động lưu',
    },
  },
  en: {
    nav: {
      overview: 'Overview',
      research: 'Research',
      domains: 'Fields',
      reports: 'Library',
      sources: 'Sources',
      collab: 'Projects',
      settings: 'Settings',
      guide: 'Guide',
      pricing: 'Pricing',
      admin: 'Host Console',
    },
    common: {
      newResearch: 'New research',
      open: 'Open report',
      empty: 'No data yet',
      quick: 'Quick', standard: 'Standard', deep: 'Deep',
      high: 'High', medium: 'Medium', low: 'Low',
    },
    overview: {
      eyebrow: 'Research command center',
      title: 'Every research project in one place.',
      description: 'Track your library and evidence, then start a new brief without losing previous work.',
      stats: ['Saved reports', 'Unique sources', 'Deep sessions', 'High-quality sources'],
      recent: 'Recent reports',
      recentHint: 'Results are read directly from the reports folder.',
      templates: 'Suggested briefs',
      templatesHint: 'Choose a framework and send it straight to the workspace.',
      noReports: 'No reports yet. Start your first session to build the library.',
      templateItems: [
        { title: 'Technology decision', topic: 'Build an evidence-based decision framework for choosing the right technology for small and medium businesses in Vietnam' },
        { title: 'Market analysis', topic: 'Analyze the size, growth drivers, competitors, and risks of the generative AI market in Vietnam through 2028' },
        { title: 'Product evaluation', topic: 'Compare internal AI assistant solutions across cost, security, quality, and practical implementation readiness' },
      ],
    },
    reports: {
      eyebrow: 'Report library',
      title: 'Report library',
      description: 'Search, filter, revisit, and download completed research.',
      search: 'Search report titles...',
      allDepths: 'All depths',
      allDomains: 'All fields',
      results: 'results',
      selectTitle: 'Select a report to read',
      selectDescription: 'The full content and report actions will appear here.',
      copy: 'Copy',
      download: 'Download PDF',
      delete: 'Delete report',
      sources: 'sources',
    },
    sources: {
      eyebrow: 'Evidence catalog',
      title: 'Research source library',
      description: 'Every real source found in your reports, with quality and usage context.',
      search: 'Search source title or domain...',
      allQuality: 'All quality levels',
      source: 'Source',
      type: 'Type',
      quality: 'Quality',
      usedIn: 'Used in',
      noSources: 'No sources match the current filters.',
    },
    settings: {
      eyebrow: 'Workspace preferences',
      title: 'Research settings',
      description: 'These choices are saved in your browser and used for future sessions.',
      language: 'Default language',
      depth: 'Default depth',
      analysts: 'Default analysts',
      approval: 'Auto approve',
      approvalHint: 'Let the pipeline run end to end without waiting for feedback.',
      connection: 'System status',
      online: 'Backend is online',
      offline: 'Backend is not connected',
      checking: 'Checking the backend',
      data: 'Workspace data',
      dataHint: 'Refresh the disk library or export a JSON backup for safekeeping.',
      refresh: 'Refresh library',
      export: 'Export backup',
      saved: 'Saved automatically',
    },
  },
} as const;

const navIcons: Record<PrimaryNavView, typeof Sparkles> = {
  overview: LayoutDashboard,
  research: Sparkles,
  domains: Shapes,
  reports: LibraryBig,
  sources: Database,
  collab: Users,
  settings: Settings2,
  guide: BookOpenCheck,
  pricing: CircleDollarSign,
  admin: ShieldCheck,
};

export function ProductNavigation({
  language,
  activeView,
  reportCount,
  onNavigate,
}: {
  language: Language;
  activeView: AppView | null;
  reportCount: number;
  onNavigate: (view: AppView) => void;
}) {
  const t = copy[language];
  return (
    <nav className="product-nav" aria-label={language === 'vi' ? 'Điều hướng chính' : 'Main navigation'}>
      {(Object.keys(t.nav) as PrimaryNavView[])
        .filter((view) => !['settings', 'guide', 'pricing', 'admin'].includes(view))
        .map((view) => {
          const Icon = navIcons[view];
          return (
            <button
              key={view}
              data-tour={`nav-${view}`}
              type="button"
              className={activeView === view ? 'is-active' : ''}
              aria-current={activeView === view ? 'page' : undefined}
              aria-label={t.nav[view]}
              onClick={() => onNavigate(view)}
            >
              <Icon size={16} />
              <span className="nav-label">{t.nav[view]}</span>
              {view === 'reports' && reportCount > 0 && <em>{reportCount}</em>}
            </button>
          );
        })}
    </nav>
  );
}

interface WorkspaceHubProps {
  view: Exclude<AppView, 'research' | 'domains' | 'guide' | 'pricing' | 'profile' | 'admin'>;
  apiBase: string;
  language: Language;
  reports: StoredReportSummary[];
  selectedReport: StoredReportDetail | null;
  loading: boolean;
  health: Health;
  researchDepth: ResearchDepth;
  maxAnalysts: number;
  autoApprove: boolean;
  onStartTopic: (topic?: string, paper?: { input: string; field: string }) => void;
  onOpenReport: (report: StoredReportSummary) => void;
  onDeleteReport: (report: StoredReportSummary) => void;
  onCopyReport: (report: StoredReportDetail) => void;
  onDownloadReport: (report: StoredReportDetail) => void;
  onLanguageChange: (language: Language) => void;
  onDepthChange: (depth: ResearchDepth) => void;
  onAnalystsChange: (count: number) => void;
  onAutoApproveChange: (value: boolean) => void;
  onRefresh: () => void;
  onExport: () => void;
}

export function WorkspaceHub(props: WorkspaceHubProps) {
  const { language, reports, view } = props;
  const t = copy[language];
  const [reportQuery, setReportQuery] = useState('');
  const [depthFilter, setDepthFilter] = useState<'all' | ResearchDepth>('all');
  const [domainFilter, setDomainFilter] = useState('all');
  const [sourceQuery, setSourceQuery] = useState('');
  const [qualityFilter, setQualityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [librarySection, setLibrarySection] = useState<'home' | 'reports' | 'papers'>('home');
  const [selectedField, setSelectedField] = useState<ScholarlyFieldId>('artificial-intelligence');

  useEffect(() => { if (view === 'reports') setLibrarySection('home'); }, [view]);

  const uniqueSources = useMemo(() => {
    const byUrl = new Map<string, StoredSource & { reports: { id: string; title: string }[] }>();
    reports.forEach((report) => {
      report.sources.forEach((source) => {
        const key = source.url.replace(/\/$/, '');
        const current = byUrl.get(key);
        if (current) {
          if (!current.reports.some((item) => item.id === report.id)) {
            current.reports.push({ id: report.id, title: report.title });
          }
        } else {
          byUrl.set(key, { ...source, reports: [{ id: report.id, title: report.title }] });
        }
      });
    });
    return [...byUrl.values()];
  }, [reports]);

  const filteredReports = useMemo(() => {
    const query = reportQuery.trim().toLocaleLowerCase();
    return reports.filter((report) => {
      const matchesQuery = !query || report.title.toLocaleLowerCase().includes(query);
      const matchesDomain = domainFilter === 'all' || report.research_domain === domainFilter;
      return matchesQuery && matchesDomain && (depthFilter === 'all' || report.research_depth === depthFilter);
    });
  }, [reports, reportQuery, depthFilter, domainFilter]);

  const filteredSources = useMemo(() => {
    const query = sourceQuery.trim().toLocaleLowerCase();
    return uniqueSources.filter((source) => {
      let domain = source.url;
      try { domain = new URL(source.url).hostname; } catch { /* keep URL */ }
      const matchesQuery = !query || `${source.title} ${domain}`.toLocaleLowerCase().includes(query);
      return matchesQuery && (qualityFilter === 'all' || source.quality === qualityFilter);
    });
  }, [uniqueSources, sourceQuery, qualityFilter]);

  if (view === 'overview') {
    const highQuality = uniqueSources.filter((source) => source.quality === 'high').length;
    const stats = [reports.length, uniqueSources.length, reports.filter((report) => report.research_depth === 'deep').length, highQuality];
    const statIcons = [Archive, Link2, Gauge, ShieldCheck];
    return (
      <div className="hub-view overview-view">
        <section className="hub-hero" data-tour="overview-hero">
          <div className="hub-hero__content">
            <span className="eyebrow">{t.overview.eyebrow}</span>
            <h1>{t.overview.title}</h1>
            <p>{t.overview.description}</p>
            <div className="hub-hero__actions">
              <button className="button button--primary" type="button" onClick={() => props.onStartTopic()}>
                <Plus size={17} />{t.common.newResearch}<ArrowRight size={16} />
              </button>
              <span className="hub-hero__assurance"><ShieldCheck size={16} />{language === 'vi' ? 'Nguồn được kiểm chứng' : 'Evidence-first workflow'}</span>
            </div>
          </div>
          <div className="hub-hero__pipeline" aria-hidden="true">
            <div className="hub-hero__pipeline-top"><span>RESEARCH PIPELINE</span><span><i />{language === 'vi' ? 'SẴN SÀNG' : 'READY'}</span></div>
            <div className="hub-hero__pipeline-steps">
              <div><span><Search size={18} /></span><div><small>01 / DISCOVER</small><strong>{language === 'vi' ? 'Tìm bằng chứng' : 'Find evidence'}</strong></div><Check size={15} /></div>
              <div><span><Users size={18} /></span><div><small>02 / ANALYZE</small><strong>{language === 'vi' ? 'Đối chiếu góc nhìn' : 'Compare perspectives'}</strong></div><Check size={15} /></div>
              <div><span><FileText size={18} /></span><div><small>03 / SYNTHESIZE</small><strong>{language === 'vi' ? 'Tạo báo cáo có nguồn' : 'Build a sourced report'}</strong></div><Sparkles size={15} /></div>
            </div>
            <div className="hub-hero__pipeline-foot"><span>{language === 'vi' ? 'TỪ CÂU HỎI ĐẾN HIỂU BIẾT' : 'FROM QUESTION TO INSIGHT'}</span><span>↗</span></div>
          </div>
        </section>

        <section className="stat-grid">
          {t.overview.stats.map((label, index) => {
            const Icon = statIcons[index];
            return <article key={label}><span><Icon size={18} /></span><strong>{stats[index]}</strong><small>{label}</small></article>;
          })}
        </section>

        <div className="hub-columns">
          <section className="hub-card recent-card">
            <div className="section-title"><div><h2>{t.overview.recent}</h2><p>{t.overview.recentHint}</p></div><FolderOpen size={20} /></div>
            {reports.length === 0 ? (
              <div className="compact-empty"><BookOpen size={25} /><p>{t.overview.noReports}</p></div>
            ) : reports.slice(0, 5).map((report) => (
              <button className="recent-report" type="button" key={report.id} onClick={() => props.onOpenReport(report)}>
                <span className={`file-icon depth-${report.research_depth}`}><FileText size={17} /></span>
                <span><strong>{report.title}</strong><small>{formatDate(report.created_at, language)} · {report.source_count} {t.reports.sources}</small></span>
                <ArrowRight size={15} />
              </button>
            ))}
          </section>

          <section className="hub-card template-card">
            <div className="section-title"><div><h2>{t.overview.templates}</h2><p>{t.overview.templatesHint}</p></div><Sparkles size={20} /></div>
            <div className="template-list">
              {t.overview.templateItems.map((template, index) => (
                <button type="button" key={template.title} onClick={() => props.onStartTopic(template.topic)}>
                  <span>0{index + 1}</span><div><strong>{template.title}</strong><small>{template.topic}</small></div><ArrowRight size={15} />
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (view === 'reports') {
    if (librarySection === 'home') return <div className="hub-view"><LibraryLanding language={language} reportCount={reports.length} onSelectField={(field) => { setSelectedField(field); setLibrarySection('papers'); }} onReports={() => setLibrarySection('reports')} /></div>;
    if (librarySection === 'papers') return <div className="hub-view"><button type="button" className="library-back" onClick={() => setLibrarySection('home')}><ArrowLeft size={18} />{language === 'vi' ? 'Tất cả lĩnh vực' : 'All disciplines'}</button><Suspense fallback={<div className="paper-library__empty">{language === 'vi' ? 'Đang mở thư viện bài báo…' : 'Opening paper library…'}</div>}><PaperLibrary key={selectedField} fieldId={selectedField} language={language} apiBase={props.apiBase} onStartResearch={(topic, paper) => props.onStartTopic(topic, paper)} /></Suspense></div>;
    return (
      <div className="hub-view">
        <button type="button" className="library-back" onClick={() => setLibrarySection('home')}><ArrowLeft size={18} />{language === 'vi' ? 'Tất cả lĩnh vực' : 'All disciplines'}</button>
        <HubHeading eyebrow={t.reports.eyebrow} title={t.reports.title} description={t.reports.description} onNew={() => props.onStartTopic()} newLabel={t.common.newResearch} />
        <div className="library-layout">
          <aside className="library-sidebar hub-card">
            <div className="library-filters">
              <label className="search-control"><Search size={16} /><input value={reportQuery} onChange={(event) => setReportQuery(event.target.value)} placeholder={t.reports.search} /></label>
              <select value={depthFilter} onChange={(event) => setDepthFilter(event.target.value as 'all' | ResearchDepth)}>
                <option value="all">{t.reports.allDepths}</option>
                <option value="quick">{t.common.quick}</option><option value="standard">{t.common.standard}</option><option value="deep">{t.common.deep}</option>
              </select>
              <select value={domainFilter} onChange={(event) => setDomainFilter(event.target.value)}>
                <option value="all">{t.reports.allDomains}</option>
                <option value="mathematics">{language === 'vi' ? 'Toán học' : 'Mathematics'}</option>
                <option value="physics">{language === 'vi' ? 'Vật lý' : 'Physics'}</option>
                <option value="chemistry">{language === 'vi' ? 'Hóa học' : 'Chemistry'}</option>
                <option value="biology">{language === 'vi' ? 'Sinh học' : 'Biology'}</option>
                <option value="artificial-intelligence">AI</option>
                <option value="general">{language === 'vi' ? 'Tổng quát' : 'General'}</option>
              </select>
            </div>
            <span className="result-count">{filteredReports.length} {t.reports.results}</span>
            <div className="report-list">
              {filteredReports.map((report) => (
                <button type="button" key={report.id} className={props.selectedReport?.id === report.id ? 'is-active' : ''} onClick={() => props.onOpenReport(report)}>
                  <span className={`file-icon depth-${report.research_depth}`}><FileText size={16} /></span>
                  <span><strong>{report.title}</strong><small>{formatDate(report.created_at, language)} · {report.source_count} {t.reports.sources}{report.research_domain && report.research_domain !== 'general' ? ` · ${report.research_domain}` : ''}</small></span>
                </button>
              ))}
            </div>
          </aside>

          <section className="library-preview hub-card">
            {props.loading ? <div className="compact-empty"><RefreshCw className="spin" size={25} /><p>Loading…</p></div> : props.selectedReport ? (
              <>
                <div className="preview-toolbar">
                  <div><span className={`depth-pill depth-${props.selectedReport.research_depth}`}>{t.common[props.selectedReport.research_depth]}</span>{props.selectedReport.research_domain && props.selectedReport.research_domain !== 'general' && <span className="report-domain-tag">{props.selectedReport.research_domain} · {props.selectedReport.research_category}</span>}<small>{formatDate(props.selectedReport.created_at, language)} · {formatBytes(props.selectedReport.size_bytes)}</small></div>
                  <div>
                    <button className="icon-button" type="button" onClick={() => props.onCopyReport(props.selectedReport!)} aria-label={t.reports.copy}><Clipboard size={16} /></button>
                    <button className="icon-button" type="button" onClick={() => props.onDownloadReport(props.selectedReport!)} aria-label={t.reports.download}><Download size={16} /></button>
                    <button className="icon-button danger-button" type="button" onClick={() => props.onDeleteReport(props.selectedReport!)} aria-label={t.reports.delete}><Trash2 size={16} /></button>
                  </div>
                </div>
                {props.selectedReport.report_data ? <Suspense fallback={<div className="compact-empty">{language === 'vi' ? 'Đang tải bằng chứng…' : 'Loading evidence…'}</div>}><ResearchEvidence key={props.selectedReport.id} data={props.selectedReport.report_data} apiBase={props.apiBase} reportId={props.selectedReport.id} /></Suspense> : <article className="report-paper library-paper"><Suspense fallback={<div className="compact-empty">{language === 'vi' ? 'Đang tải báo cáo…' : 'Loading report…'}</div>}><ReportMarkdown>{props.selectedReport.final_report}</ReportMarkdown></Suspense></article>}
              </>
            ) : <div className="compact-empty large"><BookOpen size={32} /><h3>{t.reports.selectTitle}</h3><p>{t.reports.selectDescription}</p></div>}
          </section>
        </div>
      </div>
    );
  }

  if (view === 'sources') {
    return (
      <div className="hub-view">
        <HubHeading eyebrow={t.sources.eyebrow} title={t.sources.title} description={t.sources.description} />
        <section className="hub-card source-catalog" data-tour="source-catalog">
          <div className="catalog-toolbar" data-tour="source-filters">
            <label className="search-control"><Search size={16} /><input value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder={t.sources.search} /></label>
            <select value={qualityFilter} onChange={(event) => setQualityFilter(event.target.value as typeof qualityFilter)}>
              <option value="all">{t.sources.allQuality}</option><option value="high">{t.common.high}</option><option value="medium">{t.common.medium}</option><option value="low">{t.common.low}</option>
            </select>
          </div>
          <div className="source-table-wrap">
            <table className="source-table"><thead><tr><th>{t.sources.source}</th><th>{t.sources.type}</th><th>{t.sources.quality}</th><th>{t.sources.usedIn}</th></tr></thead>
              <tbody>{filteredSources.map((source) => {
                let domain = source.url;
                try { domain = new URL(source.url).hostname; } catch { /* keep URL */ }
                return <tr key={source.url}>
                  <td data-label={t.sources.source}><a href={source.url} target="_blank" rel="noreferrer"><strong>{source.title}</strong><small>{domain}<ExternalLink size={11} /></small></a></td>
                  <td data-label={t.sources.type}><span className="type-pill">{source.source_type}</span></td>
                  <td data-label={t.sources.quality}><span className={`quality-pill quality-${source.quality}`}>{t.common[source.quality as 'high' | 'medium' | 'low'] || source.quality}</span></td>
                  <td data-label={t.sources.usedIn}><div className="used-in-list">{source.reports.slice(0, 2).map((report) => <button type="button" key={report.id} onClick={() => { const found = reports.find((item) => item.id === report.id); if (found) props.onOpenReport(found); }}>{report.title}</button>)}{source.reports.length > 2 && <small>+{source.reports.length - 2}</small>}</div></td>
                </tr>;
              })}</tbody></table>
            {filteredSources.length === 0 && <div className="compact-empty"><Link2 size={26} /><p>{t.sources.noSources}</p></div>}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="hub-view settings-view">
      <HubHeading eyebrow={t.settings.eyebrow} title={t.settings.title} description={t.settings.description} />
      <div className="settings-cards">
        <section className="hub-card settings-card">
          <div className="settings-card-title"><Globe2 size={19} /><div><h2>{t.settings.language}</h2><small>{t.settings.saved}</small></div></div>
          <div className="segmented-control">{(['vi', 'en'] as Language[]).map((item) => <button key={item} type="button" className={language === item ? 'is-active' : ''} onClick={() => props.onLanguageChange(item)}>{item === 'vi' ? 'Tiếng Việt' : 'English'}</button>)}</div>
        </section>
        <section className="hub-card settings-card">
          <div className="settings-card-title"><Gauge size={19} /><div><h2>{t.settings.depth}</h2><small>{t.settings.saved}</small></div></div>
          <div className="segmented-control three">{(['quick', 'standard', 'deep'] as ResearchDepth[]).map((depth) => <button key={depth} type="button" className={props.researchDepth === depth ? 'is-active' : ''} onClick={() => props.onDepthChange(depth)}>{t.common[depth]}</button>)}</div>
        </section>
        <section className="hub-card settings-card">
          <div className="settings-card-title"><Users size={19} /><div><h2>{t.settings.analysts}</h2><small>{t.settings.saved}</small></div></div>
          <div className="number-options">{[1, 2, 3].map((count) => <button key={count} type="button" className={props.maxAnalysts === count ? 'is-active' : ''} onClick={() => props.onAnalystsChange(count)}>{count}</button>)}</div>
        </section>
        <section className="hub-card settings-card">
          <div className="settings-card-title"><Check size={19} /><div><h2>{t.settings.approval}</h2><small>{t.settings.approvalHint}</small></div></div>
          <button className={`large-switch ${props.autoApprove ? 'is-active' : ''}`} type="button" role="switch" aria-checked={props.autoApprove} onClick={() => props.onAutoApproveChange(!props.autoApprove)}><span /></button>
        </section>
        <section className="hub-card settings-card system-card">
          <div className="settings-card-title"><ShieldCheck size={19} /><div><h2>{t.settings.connection}</h2><small>{t.settings[props.health]}</small></div></div>
          <span className={`system-indicator is-${props.health}`}><i />{t.settings[props.health]}</span>
        </section>
        <section className="hub-card settings-card data-card">
          <div className="settings-card-title"><Archive size={19} /><div><h2>{t.settings.data}</h2><small>{t.settings.dataHint}</small></div></div>
          <div className="data-actions"><button className="button button--secondary" type="button" onClick={props.onRefresh}><RefreshCw size={16} />{t.settings.refresh}</button><button className="button button--secondary" type="button" onClick={props.onExport}><Download size={16} />{t.settings.export}</button></div>
        </section>
      </div>
    </div>
  );
}

function HubHeading({ eyebrow, title, description, onNew, newLabel }: { eyebrow: string; title: string; description: string; onNew?: () => void; newLabel?: string }) {
  return <header className="hub-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{onNew && <button className="button button--primary" type="button" onClick={onNew}><Plus size={17} />{newLabel}</button>}</header>;
}

function formatDate(value: string, language: Language): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
