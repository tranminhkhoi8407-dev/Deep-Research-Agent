// Development-only visual fixture. Not an actual analysis, no paid calls.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ResearchEvidence, type ResearchReportData } from '../src/ResearchEvidence';
import '../src/styles.css';

const quote = 'The method has a training stage and a separate inference stage. Reported accuracy is 67.73 on the evaluation set.';
const proof = { chunk_id: 'A1-K1-C1', quote };
const training = { text: 'Giai đoạn huấn luyện tối ưu tham số từ dữ liệu; cần tách điều kiện huấn luyện khỏi cách đánh giá.', kind: 'reported' as const, evidence: [proof], verification: 'model_checked' };
const inference = { text: 'Giai đoạn suy luận tạo dự đoán; độ chính xác được báo cáo phải đi kèm tập đánh giá và điều kiện đo.', kind: 'reported' as const, evidence: [proof], verification: 'model_checked' };
const data: ResearchReportData = {
  schema_version: '3.0', language: 'vi', title: 'Đọc paper theo bằng chứng · mẫu kiểm thử giao diện',
  brief: { objective: 'Fixture tổng hợp để kiểm tra bố cục, công thức và tương tác; không phải phân tích hay kết quả nghiên cứu thật.', intent: 'paper', questions: ['Phương pháp hoạt động thế nào?', 'Đã tái lập được kết quả chưa?'], exclusions: [] },
  sections: [
    { key: 'answer', claims: [training] }, { key: 'scope', claims: [] },
    { key: 'mechanism', claims: [training, inference] },
    { key: 'evidence', claims: [{ text: 'Ví dụ hiển thị công thức: $J(A,B)=\\frac{|A\\cap B|}{|A\\cup B|}$. Đây là ký hiệu minh họa của fixture.', kind: 'inference', evidence: [proof], verification: 'quote_matched' }] },
    { key: 'limitations', claims: [] }, { key: 'next_steps', claims: [] },
  ],
  diagram_claim_indices: [0, 1],
  metrics: { word_count: 200, target_words: [1500, 2500], length_status: 'below_target', visual_count: 1 },
  research_domain: 'artificial-intelligence',
  dossier: [{ topic: 'methods', status: 'selected', selected_chunk_ids: [proof.chunk_id], unread_chunk_ids: [] }],
  quality_checks: [{ key: 'methods', status: 'partial', explanation: 'Fixture không mô phỏng một phân tích hoàn chỉnh.' }],
  visuals: [{ kind: 'flow', title: 'Huấn luyện và suy luận · sơ đồ fixture', caption: 'Tách hai giai đoạn và xem nguồn cho quan hệ giữa chúng.', section_key: 'mechanism', nodes: [{ id: 'train', label: 'Huấn luyện: tối ưu tham số' }, { id: 'inference', label: 'Suy luận: tạo dự đoán với tham số đã học' }], edges: [{ source: 'train', target: 'inference', label: 'Model đã học' }], evidence: [proof], verification: 'model_checked' }],
  external_visualization: { mode: 'external_link', url: 'https://www.arxivisual.org/abs/2605.03465v1', private_pdf_sent: false },
  coverage: [{ question_index: 0, status: 'answered', explanation: 'Fixture có đoạn mô tả phương pháp.', evidence: [proof] }, { question_index: 1, status: 'missing', explanation: 'Chưa chạy lại thí nghiệm.', evidence: [] }],
  conflicts: [], warnings: ['Fixture kiểm thử; các nhãn model_checked ở đây là dữ liệu mô phỏng, không phải xác minh thực tế.'],
  stop_reason: 'budget_or_evidence_limit', audit_notes: 'Không có model hay dịch vụ tìm kiếm được gọi trong trang kiểm thử này.',
  sources: [{ id: 'A1-K1', url: 'https://example.org/', title: 'Nguồn minh họa', read_status: 'full_text_available', used: true, chunks_selected: 1, chunks_available: 10 }],
  evidence: [{ id: proof.chunk_id, text: quote, locator: 'p. 9', page: 9, source_id: 'A1-K1', title: 'Nguồn minh họa', url: 'https://example.org/' }],
  counts: { discovered: 1, read: 1, used: 1 },
  budget: { max_llm_calls: 4, max_searches: 2, max_documents: 3, max_input_tokens: 18000, max_output_tokens: 8000 },
  usage: { llm_calls: 0, searches: 0, documents: 0, cache_hits: 0, input_tokens_estimated: 0, output_tokens_reserved: 0, elapsed_seconds: 0 },
};
// Rich, deliberately synthetic report. No provider is called on this page.
const pdfId = 'a'.repeat(64);
const metricQuote = 'Fixture Alpha scores 67.73; Fixture Beta scores 55.02. Both use the Synthetic development split and single-candidate accuracy.';
const mathQuote = 'J(A,B) = intersection over union. A and B are sets. J measures overlap, not correctness.';
const metricProof = { chunk_id: 'A1-K1-C2', quote: metricQuote };
const mathProof = { chunk_id: 'A1-K1-C3', quote: mathQuote };
data.schema_version = '3.1';
data.sources[0].document_id = pdfId;
data.evidence.push({ id: metricProof.chunk_id, text: metricQuote, locator: 'p. 2', page: 2, source_id: 'A1-K1', title: 'Nguồn mô phỏng', url: `/api/research/documents/${pdfId}/content`, document_id: pdfId }, { id: mathProof.chunk_id, text: mathQuote, locator: 'p. 2', page: 2, source_id: 'A1-K1', title: 'Nguồn mô phỏng', url: `/api/research/documents/${pdfId}/content`, document_id: pdfId });
data.evidence[0].document_id = pdfId; data.evidence[0].page = 1; data.evidence[0].locator = 'p. 1';
data.visuals = [
  { kind: 'flow', title: 'Huấn luyện và suy luận · sơ đồ fixture', caption: 'Chọn một bước để phân biệt lúc học tham số và lúc dùng model.', section_key: 'mechanism', evidence: [proof], verification: 'model_checked',
    nodes: [{ id: 'train', label: 'Huấn luyện: tối ưu tham số', explanation: 'Trong fixture này, giai đoạn huấn luyện tạo tham số đã học; không phải phép đo thực tế.', inputs: 'Dữ liệu huấn luyện (mô phỏng)', outputs: 'Model đã học (mô phỏng)', evidence: [proof] }, { id: 'inference', label: 'Suy luận: tạo dự đoán', explanation: 'Suy luận sử dụng model đã học để tạo dự đoán. Cần tách điều kiện suy luận khỏi điều kiện huấn luyện.', inputs: 'Model đã học và câu hỏi', outputs: 'Dự đoán chưa được kiểm chứng độc lập', evidence: [proof] }],
    edges: [{ source: 'train', target: 'inference', label: 'Sử dụng model đã học', evidence: [proof] }] },
  { kind: 'bar', title: 'Kết quả minh họa · không phải benchmark thật', caption: 'Hai con số tổng hợp chỉ để thử bố cục và tương tác.', section_key: 'evidence', evidence: [metricProof], verification: 'model_checked', columns: ['Model', 'Accuracy'], unit: '%', dataset: 'Synthetic · development', metric: 'Accuracy', conditions: 'Dữ liệu fixture, cùng tập và cách đánh giá single-candidate. Không dùng để ra quyết định nghiên cứu.',
    rows: [{ cells: ['Fixture Beta', '55.02'], explanation: 'Baseline tổng hợp của fixture; không phải kết quả paper.', evidence: [metricProof] }, { cells: ['Fixture Alpha', '67.73'], explanation: 'Con số mô phỏng để kiểm thử; không kết luận ưu thế hay khả năng production.', evidence: [metricProof] }] },
  { kind: 'equation', title: 'Khám phá ký hiệu Jaccard · fixture', caption: 'Chọn ký hiệu để đọc nghĩa của nó.', section_key: 'mechanism', evidence: [mathProof], verification: 'model_checked', equation: 'J(A,B)=\\frac{|A\\cap B|}{|A\\cup B|}', explanation: 'Tỷ lệ giữa giao và hợp minh họa độ chồng lấp; không phải chứng minh tính đúng của một dự đoán.', symbols: [{ symbol: 'A', meaning: 'Tập A trong ví dụ tổng hợp, không phải dữ liệu một thí nghiệm.', evidence: [mathProof] }, { symbol: 'B', meaning: 'Tập B để đối chiếu với A; cùng là tập hợp.', evidence: [mathProof] }] },
  { kind: 'table', title: 'Điều kiện và giới hạn · fixture', caption: 'Bảng giữ điều kiện cạnh mỗi nhận xét.', section_key: 'limitations', evidence: [proof], verification: 'model_checked', columns: ['Giai đoạn', 'Ý nghĩa'], rows: [{ cells: ['Huấn luyện', 'Tối ưu tham số'], explanation: 'Chỉ mô tả cơ chế tổng hợp để kiểm thử.', evidence: [proof] }, { cells: ['Suy luận', 'Tạo dự đoán'], evidence: [proof] }] },
];
if (new URLSearchParams(window.location.search).has('legacy')) {
  data.schema_version = '3.0';
  data.visuals = data.visuals.slice(0, 1).map(visual => ({ ...visual, nodes: visual.nodes?.map(({ id, label }) => ({ id, label })), edges: visual.edges?.map(({ source, target, label }) => ({ source, target, label })) }));
}
if (new URLSearchParams(window.location.search).get('lang') === 'en') data.language = 'en';
if (new URLSearchParams(window.location.search).get('theme') === 'dark') document.documentElement.dataset.theme = 'dark';
if (new URLSearchParams(window.location.search).get('outcome') === 'failed') {
  data.outcome = 'failed';
  data.sections = data.sections.map(section => ({ ...section, claims: [] }));
  data.counts.used = 0;
  data.stop_reason = 'analysis_failed';
  data.diagnostics = [{ stage: 'draft_report', kind: 'invalid_request', message: 'Dịch vụ model từ chối cấu trúc đầu ra (lỗi mô phỏng để kiểm thử).', fields: [] }];
  data.visuals = [];
}
const visualState = new URLSearchParams(window.location.search).get('visual_state');
if (visualState) {
  data.visuals = [];
  data.outcome = 'partial';
  if (visualState === 'legacy-invalid') {
    data.diagnostics = [{ stage: 'draft_report', kind: 'invalid_items', message: 'Lỗi visuals.0 từ report cũ (fixture).', fields: ['visuals.0'] }];
  } else if (['invalid_structure', 'source_rejected', 'audit_rejected', 'audit_unavailable', 'budget_exhausted', 'insufficient_evidence', 'not_generated'].includes(visualState)) {
    data.visual_status = { status: visualState as NonNullable<ResearchReportData['visual_status']>['status'], requested: true, attempts: 2, retained: 0, issues: [{ field: 'visuals.0.nodes.0.id', code: 'string_pattern_mismatch' }], ...(visualState === 'budget_exhausted' ? { budget_kind: 'input_budget' } : {}) };
  }
}
if (data.metrics) data.metrics.visual_count = data.visuals.length;
Object.assign(window, { __researchVisualFixture: data });
createRoot(document.getElementById('root')!).render(<React.StrictMode><main style={{ maxWidth: 1450, margin: '0 auto' }}><p role="status" style={{ padding: 20 }}>KIỂM THỬ GIAO DIỆN · Dữ liệu mô phỏng, không phải báo cáo thật</p><ResearchEvidence data={data} apiBase="" /></main></React.StrictMode>);
