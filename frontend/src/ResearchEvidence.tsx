import { useEffect, useId, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './ResearchEvidence.css';
import { researchOutcome } from './researchForm';
import { ReportExport } from './ReportExport';
import { ResearchVisual, type ReportVisual } from './ResearchVisual';
import { arxivisualUrl } from './reportExports';
import { documentIdFor, visualGenerationStatus, visualStatusMessage, type VisualGenerationStatus } from './researchVisualModel';
import { ResearchOriginalPage } from './ResearchOriginalPage';

interface Proof { chunk_id: string; quote: string }
interface Claim { text: string; kind: 'reported' | 'inference' | 'recommendation' | 'illustration' | 'derived'; evidence: Proof[]; verification: string; title?: string; aggregate?: boolean; calculation?: { result: number; operation: string; unit: string; inputs?: { label: string; value: number; evidence: Proof[] }[] } }
interface Evidence { id: string; text: string; url: string; locator: string; title: string; page?: number; source_id: string; document_id?: string }
export interface ResearchReportData {
  schema_version: string; title: string; language: 'vi' | 'en';
  outcome?: 'completed' | 'partial' | 'failed';
  diagnostics?: { stage: string; kind: string; message: string; fields: string[]; issues?: { field: string; code: string }[] }[];
  brief: { objective: string; questions: string[]; intent: string; exclusions: string[] };
  sections: { key: string; claims: Claim[] }[];
  diagram_claim_indices: number[];
  coverage: { question_index: number; status: string; explanation: string; evidence: Proof[]; assessment?: string }[];
  conflicts: string[]; warnings: string[]; stop_reason: string; audit_notes: string;
  sources: { id: string; title: string; url: string; read_status: string; used: boolean; chunks_selected: number; chunks_available: number; warning?: string; document_id?: string }[];
  evidence: Evidence[];
  counts: { discovered: number; read: number; used: number };
  budget: { max_llm_calls: number; max_searches: number; max_documents: number; max_input_tokens: number; max_output_tokens: number };
  usage: { llm_calls: number; searches: number; documents: number; cache_hits: number; input_tokens_estimated: number; output_tokens_reserved: number; elapsed_seconds: number };
  analysis_scope?: string;
  research_domain?: string;
  report_detail?: string;
  metrics?: { word_count: number; target_words: number[]; length_status: string; visual_count: number };
  quality_checks?: { key: string; status: string; explanation: string }[];
  visuals?: ReportVisual[];
  visual_status?: VisualGenerationStatus;
  external_visualization?: { url: string; mode: string; private_pdf_sent: boolean } | null;
  dossier?: { topic: string; status: string; selected_chunk_ids: string[]; unread_chunk_ids: string[] }[];
}
const titles = {
  vi: { answer: 'Trả lời trực tiếp', scope: 'Phạm vi nghiên cứu', mechanism: 'Giải thích cơ chế / phương pháp', evidence: 'Kết quả và đối chiếu', limitations: 'Phản biện và giới hạn', next_steps: 'Áp dụng và kiểm chứng tiếp' },
  en: { answer: 'Direct answer', scope: 'Research scope', mechanism: 'Mechanism / methods', evidence: 'Results and comparison', limitations: 'Critical review and limitations', next_steps: 'Application and next checks' },
};
function Prose({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{ img: ({ alt }) => <span>{alt}</span>, a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a> }}>{children}</ReactMarkdown>;
}

export function ResearchEvidence({ data, apiBase, reportId }: { data: ResearchReportData; apiBase: string; reportId?: string }) {
  const vi = data.language === 'vi';
  const outcome = researchOutcome(data);
  const [active, setActive] = useState<Claim | null>(null);
  const [tab, setTab] = useState<'read' | 'visuals' | 'original' | 'evidence' | 'review'>('read');
  const [sectionKey, setSectionKey] = useState('answer');
  const readerId = useId().replace(/:/g, '');
  const [arxivId, setArxivId] = useState('');
  const drawer = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const reportIdentity = reportId || data;
  useEffect(() => { setActive(null); setTab('read'); setSectionKey('answer'); setArxivId(''); }, [reportIdentity]);
  const openEvidence = (claim: Claim) => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActive(claim);
  };
  useEffect(() => {
    if (!active) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawer.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { document.body.style.overflow = overflow; previousFocus.current?.focus(); };
  }, [active]);
  const labels = { reported: vi ? 'Nguồn báo cáo' : 'Source-reported', inference: vi ? 'Suy luận' : 'Inference', recommendation: vi ? 'Đề xuất có điều kiện' : 'Conditional recommendation', illustration: vi ? 'Ví dụ giảng giải · không phải thí nghiệm đã chạy' : 'Teaching illustration · not an executed experiment', derived: vi ? 'Kết quả tính từ số liệu nguồn' : 'Computed from source data' };
  const accessLabels: Record<string, string> = vi ? {
    discovered: 'Mới tìm thấy', full_text_available: 'Có chữ toàn văn', partial_text: 'Trích xuất một phần', abstract_or_landing: 'Abstract / trang giới thiệu', fetch_failed: 'Không truy xuất được',
  } : { discovered: 'Discovered only', full_text_available: 'Full text available', partial_text: 'Partial extraction', abstract_or_landing: 'Abstract / landing page', fetch_failed: 'Retrieval failed' };
  const stopLabels: Record<string, string> = vi ? {
    input_budget_reserved_for_writing: 'Giữ ngân sách đọc cho bước viết và kiểm tra',
    call_budget_reserved_for_writing: 'Giữ lượt gọi model cho bước viết và kiểm tra',
    no_follow_up_selected: 'Không chọn được bước đọc hoặc tìm bổ sung phù hợp',
    coverage_processing_error: 'Chưa đánh giá được độ bao phủ do lỗi xử lý dẫn chứng',
    coverage_unverified: 'Độ bao phủ chưa được đối chiếu xong',
    time_budget: 'Hết thời gian đã đặt cho phiên nghiên cứu',
    reading_round_limit: 'Hết số vòng đọc cho chế độ đã chọn',
    report_quality_incomplete: 'Bản viết chưa đạt đủ tiêu chí giải thích và kiểm chứng',
    final_coverage_incomplete: 'Bản viết cuối chưa trả lời đủ các câu hỏi',
    coverage_satisfied: 'Các câu hỏi đã có bằng chứng theo bước đánh giá độ bao phủ', budget_or_evidence_limit: 'Chạm giới hạn ngân sách hoặc chưa có thêm bằng chứng phù hợp', primary_paper_unavailable: 'Chưa đọc được paper chính', no_readable_evidence: 'Chưa có nội dung nguồn đọc được', analysis_failed: 'Bước tạo nội dung phân tích thất bại', no_supported_claims: 'Không còn nhận xét có dẫn chứng sau kiểm tra',
  } : { input_budget_reserved_for_writing: 'Input budget reserved for writing and auditing', call_budget_reserved_for_writing: 'Calls reserved for writing and auditing', no_follow_up_selected: 'No suitable follow-up selected', coverage_processing_error: 'Coverage evidence processing failed', coverage_unverified: 'Coverage not yet reconciled', coverage_satisfied: 'Question coverage assessment satisfied', budget_or_evidence_limit: 'Budget or available evidence limit', primary_paper_unavailable: 'Primary paper unavailable', no_readable_evidence: 'No readable source content', analysis_failed: 'Analysis generation failed', no_supported_claims: 'No supported claims after validation' };
  const sourceLink = (url: string, page?: number) => (url.startsWith('/api/') ? apiBase + url : url) + (page ? '#page=' + page : '');
  const coverageLabel = (item: ResearchReportData['coverage'][number]) => item.assessment === 'processing_error' ? (vi ? 'Lỗi xử lý dẫn chứng' : 'Evidence processing error') : item.assessment === 'unverified' ? (vi ? 'Chưa đối chiếu xong' : 'Not reconciled') : item.status === 'answered' ? (vi ? 'Đã trả lời có dẫn chứng' : 'Supported written answer') : item.status === 'partial' ? (vi ? 'Trả lời một phần' : 'Partly answered') : (vi ? 'Chưa đủ bằng chứng đã đọc' : 'Insufficient read evidence');
  const mechanism = data.sections.find(section => section.key === 'mechanism')?.claims || [];
  const visuals = data.visuals || [];
  const visualStatus = visualGenerationStatus(data);
  const visualMessage = visualStatusMessage(visualStatus.status, vi);
  const externalUrl = data.external_visualization?.url ? arxivisualUrl(data.external_visualization.url.replace('www.arxivisual.org', 'arxiv.org')) : arxivisualUrl(arxivId);
  const renderVisual = (visual: ReportVisual, index: number) => <ResearchVisual key={`${visual.kind}-${visual.title}-${index}`} visual={visual} vi={vi} onEvidence={selection => openEvidence({ ...selection, kind: 'reported' })} />;
  const jumpToSection = (key: string) => {
    setSectionKey(key); setTab('read');
    requestAnimationFrame(() => {
      const target = document.getElementById(`${readerId}-${key}`);
      target?.scrollIntoView({ block: 'start', behavior: 'auto' }); target?.focus({ preventScroll: true });
    });
  };
  const pdfSources = data.sources.filter(source => documentIdFor(source));
  const originalFor = (excerpt: Evidence) => documentIdFor(excerpt) || documentIdFor(data.sources.find(source => source.id === excerpt.source_id) || { url: '' });
  return <div className="research-evidence research-reader">
    <aside className="research-reader__rail" aria-label={vi ? 'Điều hướng báo cáo' : 'Report navigation'}>
      <small className="research-visual__eyebrow">NEXORA · {vi ? 'BÁO CÁO' : 'REPORT'}</small>
      <nav className="research-evidence__tabs" aria-label={vi ? 'Các lớp đọc báo cáo' : 'Report reading layers'}>
        {(['read', 'visuals', 'original', 'evidence', 'review'] as const).map(id => <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{id === 'read' ? (vi ? 'Hiểu và giải thích' : 'Understand') : id === 'visuals' ? (vi ? 'Khám phá trực quan' : 'Visual explorer') : id === 'original' ? (vi ? 'Paper gốc' : 'Original paper') : id === 'evidence' ? (vi ? 'Bằng chứng và nguồn' : 'Evidence and sources') : (vi ? 'Phản biện & ngân sách' : 'Review & budget')}</button>)}
      </nav>
      <details open className="research-reader__toc"><summary>{vi ? 'Mục lục nội dung' : 'Report contents'}</summary><nav aria-label={vi ? 'Mục lục nội dung' : 'Report contents'}>{data.sections.map((section, index) => <button type="button" key={section.key} aria-label={titles[data.language][section.key as keyof typeof titles.vi] || section.key} aria-current={tab === 'read' && sectionKey === section.key ? 'location' : undefined} onClick={() => jumpToSection(section.key)}><span>{String(index + 1).padStart(2, '0')}</span>{titles[data.language][section.key as keyof typeof titles.vi] || section.key}{!section.claims.length && <small>{vi ? 'Chưa đủ' : 'Incomplete'}</small>}</button>)}</nav></details>
      <p className="research-reader__note">{visuals.length} {vi ? 'hình có nguồn · thao tác xem không gọi AI' : 'sourced visuals · browsing does not call AI'}</p>
      {reportId && <details><summary>{vi ? 'Tải PDF / LaTeX' : 'Download PDF / LaTeX'}</summary><ReportExport apiBase={apiBase} reportId={reportId} vi={vi} /></details>}
    </aside>
    <div className="research-reader__content">
    <header><span className="eyebrow">{data.brief.intent === 'paper' ? 'PAPER ANALYSIS' : 'EVIDENCE-FIRST RESEARCH'} · {data.language.toUpperCase()}</span><h1>{data.title}</h1><p>{data.brief.objective}</p>
      <details className="research-reader__metadata"><summary>{vi ? 'Thông tin phiên nghiên cứu & nguồn' : 'Research session & sources'}</summary><div className="research-evidence__counts"><span><strong>{data.counts.discovered}</strong>{vi ? 'Tìm thấy' : 'Discovered'}</span><span><strong>{data.counts.read}</strong>{vi ? 'Đã đọc đoạn' : 'Excerpts read'}</span><span><strong>{data.counts.used}</strong>{vi ? 'Được dùng' : 'Used'}</span><span><strong>{data.usage.cache_hits}</strong>Cache</span></div></details>
    </header>
    {data.metrics && <p>{vi ? 'Nội dung phân tích' : 'Analysis content'}: {data.metrics.word_count.toLocaleString()} {vi ? 'từ' : 'words'} · {vi ? 'mục tiêu' : 'target'} {data.metrics.target_words.map(value => value.toLocaleString()).join('–')} · {data.research_domain || data.brief.intent}. {vi ? 'Không tính phụ lục trích đoạn; cách đếm theo khoảng trắng.' : 'Excludes quote appendices; whitespace-based counting.'}</p>}
    {outcome !== 'completed' && <div className="research-evidence__warning" role={outcome === 'failed' ? 'alert' : 'status'}><strong>{outcome === 'failed' ? (vi ? 'Phân tích chưa thành công' : 'Analysis failed') : (vi ? 'Báo cáo một phần' : 'Partial report')}</strong><p>{outcome === 'failed' ? (vi ? 'Chưa tạo được nội dung có dẫn chứng từ các nguồn truy xuất. Đây là hồ sơ lỗi và bằng chứng, không phải báo cáo hoàn chỉnh.' : 'No supported analysis was produced from retrieved sources. This is a diagnostic and evidence record, not a completed report.') : (vi ? 'Một số câu hỏi, mục nội dung hoặc bước đối chiếu chưa hoàn tất. Xem phần phản biện để biết những gì còn thiếu.' : 'Some questions, sections or verification steps are incomplete. See the review layer for remaining gaps.')}</p></div>}
    {!!data.diagnostics?.length && <details className="research-evidence__diagnostics" open={outcome === 'failed'}><summary>{vi ? 'Thông tin lỗi trong phiên phân tích' : 'Analysis diagnostics'}</summary>{data.diagnostics.map((item, index) => <div key={index}><p><strong>{item.stage}</strong>: {item.message} <small>({item.kind})</small>{!!item.fields.length && <small> · {item.fields.join(', ')}</small>}</p>{!!item.issues?.length && <ul>{item.issues.map((issue, issueIndex) => <li key={issueIndex}><code>{issue.field}</code> · {issue.code}</li>)}</ul>}</div>)}</details>}
    {data.analysis_scope === 'preliminary' && <p className="research-evidence__warning">{vi ? 'Phân tích sơ bộ: chưa xác nhận truy cập toàn văn paper; nguồn chính chỉ là trang giới thiệu / abstract.' : 'Preliminary analysis: full-paper access is not confirmed; the primary source is an abstract/landing page.'}</p>}
    {data.analysis_scope === 'unavailable' && <p className="research-evidence__warning">{vi ? 'Chưa đọc được paper chính. Không dùng bài liên quan để giả làm phân tích bài này; hãy tải PDF có chữ.' : 'The primary paper could not be read. Related papers were not used as a substitute analysis; upload a text PDF.'}</p>}
    {tab === 'read' && <>
      <section><h2>{vi ? 'Câu hỏi cần trả lời' : 'Questions to answer'}</h2><ol>{data.brief.questions.map(question => <li key={question}>{question}</li>)}</ol></section>
      {!data.visuals && mechanism.length > 1 && <section className="research-evidence__map"><h2>{vi ? 'Các nhận xét về phương pháp · report cũ' : 'Method claims · legacy report'}</h2><small>{vi ? 'Các thẻ dưới đây không phải sơ đồ quan hệ.' : 'These cards are not a relational diagram.'}</small><div>{data.diagram_claim_indices.map(index => mechanism[index] && <button type="button" key={index} onClick={() => openEvidence(mechanism[index])}><span>{String(index + 1).padStart(2, '0')}</span><p>{mechanism[index].text.slice(0, 180)}{mechanism[index].text.length > 180 ? '…' : ''}</p><small>{vi ? 'Mở dẫn chứng' : 'Inspect evidence'} ↗</small></button>)}</div></section>}
      {data.sections.map(section => <section key={section.key} id={`${readerId}-${section.key}`} tabIndex={-1} className="research-reader__section"><h2>{titles[data.language][section.key as keyof typeof titles.vi]}</h2>{section.claims.length ? section.claims.map((claim, index) => <div className="research-evidence__claim" key={index}><small>{labels[claim.kind]}</small><Prose>{claim.text}</Prose>{claim.calculation?.result !== undefined && <p>{vi ? 'Tính bằng chương trình' : 'Program-computed'}: {claim.calculation.result} {claim.calculation.unit}</p>}<button type="button" onClick={() => openEvidence(claim)}>{claim.evidence.length} {vi ? 'dẫn chứng' : 'evidence excerpts'} · {claim.verification === 'model_checked' ? (vi ? 'đã đối chiếu bằng model' : 'model checked') : (vi ? 'chỉ khớp trích đoạn' : 'quote match only')}</button></div>) : <p className="research-evidence__muted">{vi ? 'Chưa đủ bằng chứng đã đọc để viết mục này.' : 'Insufficient read evidence for this section.'}</p>}{visuals.filter(visual => visual.section_key === section.key).map(renderVisual)}</section>)}
    </>}
    {tab === 'visuals' && <>
      {visuals.length ? visuals.map(renderVisual) : <section className="research-visual-status" role="status" data-status={visualStatus.status}><h2>{visualMessage.title}</h2><p>{visualMessage.detail}</p>{visualStatus.attempts !== undefined && <small>{vi ? 'Lượt tạo/sửa hình' : 'Generation/repair attempts'}: {visualStatus.attempts} · {vi ? 'Hình giữ lại' : 'Figures retained'}: {visualStatus.retained || 0}</small>}{visualStatus.budget_kind && <p>{vi ? 'Giới hạn' : 'Limit'}: {visualStatus.budget_kind}</p>}{!!visualStatus.issues?.length && <details><summary>{vi ? 'Chi tiết kiểm tra hình' : 'Visual validation details'}</summary><ul>{visualStatus.issues.map((issue, index) => <li key={index}><code>{issue.field}</code> · {issue.code}</li>)}</ul></details>}<p>{vi ? 'Report đã lưu không tự chạy lại. Để dùng luồng tạo hình mới, tạo một phiên nghiên cứu mới; thao tác xem ở đây không gọi AI.' : 'Saved reports are not regenerated automatically. Start a new run to use the new visual pipeline; browsing here does not call AI.'}</p></section>}
      <section className="research-arxivisual"><h2>arXivisual</h2><p>{vi ? 'Mở bản minh họa trên arXivisual trong tab riêng. Đây là dịch vụ bên ngoài; kết quả của dịch vụ chưa được hệ thống kiểm chứng. Không gửi PDF tải lên hay hồ sơ của bạn.' : 'Open the visualization on arXivisual in a separate tab. This external service is not verified by our audit. Your uploaded PDF and account data are not sent.'}</p>
        {!data.external_visualization && <label>{vi ? 'arXiv ID của bài công khai (tùy chọn)' : 'Public paper arXiv ID (optional)'}<input value={arxivId} maxLength={250} onChange={event => setArxivId(event.target.value)} placeholder="2605.03465v1" /></label>}
        {externalUrl ? <a href={externalUrl} target="_blank" rel="noreferrer">{vi ? 'Mở bài này trên arXivisual' : 'Open this paper on arXivisual'} ↗</a> : <small>{vi ? 'Chỉ hỗ trợ ID/URL arXiv hợp lệ. PDF riêng tư không được tự gửi sang dịch vụ.' : 'Only valid arXiv IDs/URLs are supported. Private PDFs are never sent automatically.'}</small>}
      </section>
    </>}
    {tab === 'original' && <section><h2>{vi ? 'Đối chiếu paper gốc' : 'Inspect the original paper'}</h2><p>{vi ? 'Xem đúng trang PDF, bao gồm hình và bảng gốc. Các hình không được tự nhận dạng hay diễn giải bởi AI; hãy mở dẫn chứng của từng nhận xét để xem vị trí có liên quan.' : 'Inspect the original page, including figures and tables. Images are not automatically recognized or explained by AI; open claim evidence to inspect relevant locations.'}</p>{pdfSources.length ? pdfSources.map(source => { const excerpt = data.evidence.find(item => item.source_id === source.id && item.page); return <div key={source.id}><h3>{source.title}</h3><ResearchOriginalPage apiBase={apiBase} documentId={documentIdFor(source)!} page={excerpt?.page || 1} quote={excerpt?.text.slice(0, 400) || 'No excerpt available'} vi={vi} /></div>; }) : <p>{vi ? 'Chưa có PDF gốc trong kho của tài khoản cho report này. Report cũ chỉ có URL công khai vẫn mở được nguồn từ mục Bằng chứng; không tự tải nguồn mới.' : 'This report has no stored original PDF in your account. Legacy public URLs are available under Evidence; no new source is downloaded automatically.'}</p>}</section>}
    {tab === 'evidence' && <>
      <p>{vi ? 'Có toàn văn trong kho không có nghĩa agent đọc toàn bộ. Đã đọc đoạn = đoạn thực sự đưa vào phân tích; không tính snippet tìm kiếm.' : 'Stored full text does not mean every part was read. Excerpts read are chunks supplied to analysis, not search snippets.'}</p>
      <div className="research-evidence__table"><table><thead><tr><th>{vi ? 'Nguồn' : 'Source'}</th><th>{vi ? 'Truy cập' : 'Access'}</th><th>{vi ? 'Đoạn chọn / có sẵn' : 'Selected / available'}</th><th>{vi ? 'Được dùng' : 'Used'}</th></tr></thead><tbody>{data.sources.map(source => <tr key={source.id}><td><a href={sourceLink(source.url)} target="_blank" rel="noreferrer">{source.title}</a></td><td>{accessLabels[source.read_status] || source.read_status}</td><td>{source.chunks_selected || 0} / {source.chunks_available || 0}</td><td>{source.used ? (vi ? 'Có' : 'Yes') : '—'}</td></tr>)}</tbody></table></div>
      {data.evidence.map(item => <details key={item.id} id={'evidence-' + item.id}><summary>{item.id} · {item.locator} · {item.title}</summary><pre>{item.text}</pre><a href={sourceLink(item.url, item.page)} target="_blank" rel="noreferrer">{vi ? 'Mở nguồn tại vị trí này' : 'Open source at location'} ↗</a></details>)}
    </>}
    {tab === 'review' && <>
      {!!data.quality_checks?.length && <section><h2>{vi ? 'Kiểm tra chiều sâu giải thích' : 'Explanation quality checks'}</h2><small>{vi ? 'Đánh giá bằng model, không phải chứng nhận đúng khoa học.' : 'Model assessment, not scientific certification.'}</small>{data.quality_checks.map(item => <div className="research-evidence__coverage" key={item.key}><strong>{item.key}</strong><span data-status={item.status}>{item.status}</span><p>{item.explanation}</p></div>)}</section>}
      {data.dossier && <details><summary>{vi ? 'Hồ sơ các phần đã chọn đọc' : 'Reading dossier'}</summary><p>{vi ? 'Phân loại bằng từ khóa để định hướng đọc, không khẳng định đã hiểu hết mục tương ứng.' : 'Keyword categories guide reading; they do not certify full understanding of a section.'}</p>{data.dossier.map(item => <p key={item.topic}>{item.topic}: {item.status} · {item.selected_chunk_ids.join(', ')}{item.unread_chunk_ids.length > 0 && ' · unread: ' + item.unread_chunk_ids.join(', ')}</p>)}</details>}
      <section><h2>{vi ? 'Độ bao phủ câu hỏi' : 'Question coverage'}</h2><p>{vi ? 'Phân biệt thiếu nội dung nguồn, lỗi xử lý dẫn chứng và bản viết chưa hoàn tất. Đã trả lời là trạng thái của bản report, không chỉ của paper.' : 'Source gaps, evidence-processing failures and unfinished writing are distinct. Answered describes this report, not just the paper.'}</p>{data.coverage.map(item => <div className="research-evidence__coverage" key={item.question_index}><strong>{data.brief.questions[item.question_index]}</strong><span data-status={item.assessment === 'processing_error' || item.assessment === 'unverified' ? 'partial' : item.status}>{coverageLabel(item)}</span><p>{item.explanation}</p></div>)}</section>
      {!!data.conflicts.length && <section><h2>{vi ? 'Bất đồng cần đối chiếu' : 'Conflicts to inspect'}</h2><ul>{data.conflicts.map(conflict => <li key={conflict}>{conflict}</li>)}</ul></section>}
      <section><h2>{vi ? 'Chi phí và điểm dừng' : 'Usage and stopping limits'}</h2><p>LLM: {data.usage.llm_calls}/{data.budget.max_llm_calls} · Search: {data.usage.searches}/{data.budget.max_searches} · Documents: {data.usage.documents}/{data.budget.max_documents} · {data.usage.elapsed_seconds}s</p><p>Input ≈ {data.usage.input_tokens_estimated}/{data.budget.max_input_tokens} · Output ≤ {data.usage.output_tokens_reserved}/{data.budget.max_output_tokens}</p><p>{vi ? 'Lý do dừng' : 'Stop reason'}: {stopLabels[data.stop_reason] || data.stop_reason}</p><small>{vi ? 'Token ước tính / dự trữ không phải hóa đơn chính xác. Thời gian kiểm tra giữa các bước; tác vụ đang chạy có timeout riêng.' : 'Estimated/reserved tokens are not an exact bill. Time limits are checked between steps; running operations have their own timeout.'}</small></section>
      <section><h2>{vi ? 'Giới hạn xác minh' : 'Verification limits'}</h2><p>{data.audit_notes}</p><p>{vi ? 'Chưa chạy lại thí nghiệm hay xác nhận chứng minh hình thức. Trích xuất chữ từ PDF có thể sai bố cục bảng, công thức và hình; cần mở trang gốc đối chiếu.' : 'No experiment rerun or formal proof certification. PDF text extraction may misread tables, formulas and figures; inspect original pages.'}</p>{data.warnings.map(warning => <p className="research-evidence__warning" key={warning}>{warning}</p>)}</section>
    </>}
    </div>
    {active && <div className="research-evidence__overlay" onClick={() => setActive(null)}>
      <section ref={drawer} className="research-evidence__drawer" role="dialog" aria-modal="true" aria-label={vi ? 'Dẫn chứng cho nhận xét' : 'Evidence for claim'} onClick={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === 'Escape') setActive(null);
        if (event.key === 'Tab') {
          const focusable = Array.from(drawer.current?.querySelectorAll<HTMLElement>('button, a[href], summary, input, select, textarea, [tabindex="0"]') || []).filter(element => element.getClientRects().length > 0);
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <button type="button" autoFocus onClick={() => setActive(null)}>{vi ? 'Đóng' : 'Close'} ×</button><h2>{active.title || (vi ? 'Nhận xét → bằng chứng' : 'Claim → evidence')}</h2>{active.aggregate && <p className="research-evidence__warning">{vi ? 'Report này chỉ lưu nguồn chung của hình, chưa có dẫn chứng riêng cho thành phần được chọn.' : 'This report only has figure-level evidence, not a component-specific citation.'}</p>}<Prose>{active.text}</Prose>
        {active.evidence.map((proof, index) => { const excerpt = data.evidence.find(item => item.id === proof.chunk_id); return <div key={index}><h3>{excerpt?.title} · {excerpt?.locator}</h3><blockquote>{proof.quote}</blockquote>{excerpt && <><details><summary>{vi ? 'Đọc ngữ cảnh xung quanh' : 'Read surrounding context'}</summary><pre>{excerpt.text}</pre></details><a href={sourceLink(excerpt.url, excerpt.page)} target="_blank" rel="noreferrer">{vi ? 'Mở nguồn gốc' : 'Open original'} ↗</a>{excerpt.page && originalFor(excerpt) && <ResearchOriginalPage apiBase={apiBase} documentId={originalFor(excerpt)!} page={excerpt.page} quote={proof.quote} vi={vi} />}</>}</div>; })}
      </section>
    </div>}
  </div>;
}
