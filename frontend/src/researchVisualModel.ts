/** Local report inspection only: never execute model-supplied expressions. */
export interface VisualProof { chunk_id: string; quote: string }
export interface VisualNode { id: string; label: string; explanation?: string; inputs?: string; outputs?: string; evidence?: VisualProof[] }
export interface VisualRow { cells: string[]; explanation?: string; evidence?: VisualProof[] }
export interface ReportVisual {
  kind: 'flow' | 'table' | 'bar' | 'equation'; title: string; caption: string; section_key: string;
  evidence: VisualProof[]; nodes?: VisualNode[]; edges?: { source: string; target: string; label: string; evidence?: VisualProof[] }[];
  columns?: string[]; rows?: VisualRow[]; unit?: string; conditions?: string; dataset?: string; metric?: string;
  equation?: string; explanation?: string; symbols?: { symbol: string; meaning: string; evidence: VisualProof[] }[];
  verification: string; omitted_numeric_annotations?: string[];
}
export interface VisualSelection { title: string; text: string; evidence: VisualProof[]; verification: string; aggregate: boolean }
export interface VisualGenerationStatus {
  status: 'ready' | 'not_requested' | 'not_generated' | 'pending_audit' | 'invalid_structure' | 'source_rejected' | 'audit_rejected' | 'audit_unavailable' | 'budget_exhausted' | 'insufficient_evidence' | 'generation_failed';
  requested?: boolean; attempts?: number; generated?: number; retained?: number; budget_kind?: string;
  issues?: { field: string; code: string }[];
}
export function visualGenerationStatus(data: { visuals?: ReportVisual[]; visual_status?: VisualGenerationStatus; diagnostics?: { kind: string; fields: string[] }[] }): VisualGenerationStatus {
  if (data.visual_status) return data.visual_status;
  // Old reports discarded malformed figures before recording their exact field.
  // Do not mislabel that as a semantic/evidence rejection or invent a reason.
  if (data.visuals?.length) return { status: 'ready' };
  const invalid = data.diagnostics?.find(item => ['invalid_items', 'invalid_structure'].includes(item.kind) && item.fields.some(field => field.startsWith('visuals')));
  return invalid ? { status: 'invalid_structure' } : { status: 'not_generated' };
}
export function visualStatusMessage(status: VisualGenerationStatus['status'], vi: boolean): { title: string; detail: string } {
  const messages: Record<VisualGenerationStatus['status'], [string, string, string, string]> = {
    ready: ['Hình đã qua đối chiếu', 'Chọn từng thành phần để xem giải thích và nguồn.', 'Visuals reviewed', 'Select a component to inspect its explanation and source.'],
    not_requested: ['Phiên này chưa yêu cầu tạo hình', 'Chọn giải thích Chi tiết hoặc Chuyên sâu, hoặc yêu cầu sơ đồ trong đề bài.', 'Visuals not requested', 'Choose Detailed or Extended explanation, or ask for a diagram in the brief.'],
    not_generated: ['Chưa tạo được hình', 'Không có hình hợp lệ được trả về. Trạng thái này không khẳng định rằng nguồn thiếu thông tin.', 'No visuals generated', 'No valid figure was returned. This does not establish that the sources lack information.'],
    pending_audit: ['Hình chưa được kiểm chứng xong', 'Không trình bày hình nháp như một kết quả đã xác minh.', 'Visual review pending', 'Draft figures are not presented as verified results.'],
    invalid_structure: ['Hình bị lỗi định dạng', 'Model đã trả hình sai cấu trúc. Đây là lỗi tạo hình, không phải kết luận rằng nguồn thiếu bằng chứng.', 'Invalid visual structure', 'The model returned a malformed figure. This is a generation defect, not a conclusion that evidence is missing.'],
    source_rejected: ['Hình chưa khớp nguồn', 'Một thành phần, số liệu hoặc quan hệ không có trích đoạn hợp lệ; hình không được hiển thị.', 'Visual failed source checks', 'A component, value or relationship lacks a valid source excerpt; the figure is not displayed.'],
    audit_rejected: ['Hình không qua đối chiếu ngữ nghĩa', 'Nguồn không chứng minh đầy đủ nội dung/quan hệ trong hình, hoặc thiếu nhận xét kiểm tra tương ứng.', 'Visual failed semantic review', 'The source did not establish all figure assertions/relationships, or a required review verdict was missing.'],
    audit_unavailable: ['Chưa kiểm chứng được hình', 'Bước đối chiếu thất bại hoặc hết ngân sách. Không tự giữ lại hình chưa được kiểm tra.', 'Visual review unavailable', 'Review failed or reached its budget. Unreviewed figures are not retained.'],
    budget_exhausted: ['Chưa đủ ngân sách để hoàn tất hình', 'Hệ thống giữ phần ngân sách còn lại cho kiểm chứng báo cáo; không tự tăng giới hạn bạn đã chọn.', 'Visual budget unavailable', 'The remaining budget is reserved for report verification; your chosen limits were not increased.'],
    insufficient_evidence: ['Chưa tạo hình từ các đoạn đã đọc', 'Chưa có đoạn phù hợp, hoặc model chưa tìm được hình có thể dẫn chứng từ bộ đoạn này. Không có nghĩa toàn bộ tài liệu thiếu thông tin.', 'No sourced figure from the read excerpts', 'Suitable excerpts were unavailable, or the model could not build a cited figure from this packet. This does not mean the full document lacks information.'],
    generation_failed: ['Bước tạo hình gặp lỗi', 'Xem thông tin lỗi của phiên. Bài phân tích và nguồn đã đọc vẫn được giữ; không thay hình bằng dữ liệu bịa.', 'Visual generation failed', 'Inspect the run diagnostics. Written analysis and source excerpts are retained; figures are not replaced with invented data.'],
  };
  const message = messages[status] || messages.not_generated;
  return { title: message[vi ? 0 : 2], detail: message[vi ? 1 : 3] };
}
export function componentEvidence(visual: ReportVisual, title: string, text: string, own?: VisualProof[]): VisualSelection {
  return { title, text, evidence: own?.length ? own : visual.evidence, verification: visual.verification, aggregate: !own?.length };
}
export function numericValue(value?: string): number | null {
  // Empty cells, N/A, Infinity and expressions must not become measurements.
  if (!value || !/^[+]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value.trim())) return null;
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
export function orderedRows(rows: VisualRow[], order: 'source' | 'descending'): { row: VisualRow; sourceIndex: number }[] {
  const indexed = rows.map((row, sourceIndex) => ({ row, sourceIndex }));
  return order === 'source' ? indexed : indexed.sort((a, b) => (numericValue(b.row.cells[1]) ?? -Infinity) - (numericValue(a.row.cells[1]) ?? -Infinity) || a.sourceIndex - b.sourceIndex);
}
export function documentIdFor(source: { document_id?: string; url: string }): string | null {
  if (source.document_id && /^[a-f0-9]{64}$/.test(source.document_id)) return source.document_id;
  return /^\/api\/research\/documents\/([a-f0-9]{64})\/content$/.exec(source.url)?.[1] ?? null;
}
export function originalPageUrl(apiBase: string, documentId: string, page: number, mode: 'image' | 'locate'): string | null {
  if (!/^[a-f0-9]{64}$/.test(documentId) || !Number.isInteger(page) || page < 1 || page > 100) return null;
  return `${apiBase}/api/research/documents/${documentId}/pages/${page}/${mode}`;
}
