export type ChatEngine = 'nexora' | 'opencode';
export function chatModeLabel(engine: ChatEngine): string { return engine === 'opencode' ? 'Research Together' : 'Chat'; }
export interface ChatModel { id: string; name: string; policy: string; private_allowed: boolean; ready?: boolean; code?: string; image_inputs?: boolean; pdf_attachments?: boolean; transport?: string; gateway_ready?: boolean; gateway_code?: string }
export const DEFAULT_OPENCODE_MODEL = 'muse-spark-1.3-contributor-free';
export function defaultOpenCodeModel(models: readonly ChatModel[]): string {
  // Availability must not silently change the user's requested provider/model.
  return models.some(item => item.id === DEFAULT_OPENCODE_MODEL) ? DEFAULT_OPENCODE_MODEL : '';
}
export interface ChatAttachment { id: string; name: string; mime: string; kind: 'image' | 'document'; size: number; warning: string }
export interface ChatConfig { opencode: { configured: boolean; ready: boolean; code: string; version?: string; models: ChatModel[]; direct_enabled?: boolean; default_model?: string; gateway_ready?: boolean; gateway_code?: string }; nexora?: { ready: boolean; image_inputs?: boolean }; attachments?: { max_file_bytes: number; max_total_bytes: number; max_files: number; max_images: number; extensions: string[] } }
export interface ChatSummary { id: string; title: string; engine: ChatEngine; model: string; model_label?: string; runtime_transport?: string; pinned: boolean; archived: boolean; updated_at: number; latest_job?: ChatJob | null }
export interface ChatJob { id: string; action: 'chat' | 'report'; status: string; stage: string; error_code?: string; report_id?: string; usage: Record<string, number>; created_at?: number; updated_at?: number }
export interface ChatActivity extends ChatJob { conversation_id: string; title: string; engine: ChatEngine }
export interface ChatQuestion { id: string; job_id: string; state: string; expires_at: number; questions: { header: string; question: string; options: { label: string; description: string }[]; multiple: boolean; custom: boolean }[]; answers?: string[][] | null }
export interface ChatDetail extends ChatSummary { messages: { id: string; role: string; body: string; job_id: string; created_at: number; attachments?: ChatAttachment[] }[]; jobs: ChatJob[]; settings: Record<string, unknown>; questions?: ChatQuestion[] }
export const defaultAttachmentLimits = { max_file_bytes: 10 * 1024 * 1024, max_total_bytes: 20 * 1024 * 1024, max_files: 5, max_images: 3, extensions: ['.pdf', '.docx', '.txt', '.md', '.csv', '.json', '.log', '.py', '.js', '.ts', '.tsx', '.tex', '.yaml', '.yml', '.png', '.jpg', '.jpeg', '.webp'] };
export function isImageFile(file: Pick<File, 'name'>): boolean { return /\.(png|jpe?g|webp)$/i.test(file.name); }
export function isPdfFile(file: Pick<File, 'name'>): boolean { return /\.pdf$/i.test(file.name); }
export function publicPdfSupported(model: ChatModel | undefined, transport: string | undefined): boolean {
  return model?.id === DEFAULT_OPENCODE_MODEL && model.pdf_attachments === true && transport === 'direct_hil_v1';
}
export function fileSize(size: number): string { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`; }
export function validateChatFiles(files: Pick<File, 'name' | 'size'>[], limits = defaultAttachmentLimits): string {
  if (files.length > limits.max_files || files.filter(isImageFile).length > limits.max_images || files.reduce((sum, file) => sum + file.size, 0) > limits.max_total_bytes) return 'attachment_count_limit';
  for (const file of files) {
    if (!file.size) return 'attachment_empty';
    if (file.size > limits.max_file_bytes) return 'attachment_too_large';
    if (!limits.extensions.includes(`.${file.name.split('.').pop()?.toLowerCase()}`)) return 'attachment_unsupported_type';
  }
  return '';
}
export function sidebarWidth(value: number): number { return Math.min(360, Math.max(200, Number.isFinite(value) ? value : 280)); }
export function runningChat(job?: ChatJob): boolean { return !!job && ['queued', 'running', 'awaiting_input'].includes(job.status); }
export function latestReport(jobs: ChatJob[]): string | undefined { return jobs.find(job => job.report_id)?.report_id; }
export function statusLabel(status: string, vi: boolean): string {
  const labels: Record<string, [string, string]> = { awaiting_input: ['Chờ bạn trả lời', 'Needs your answer'], queued: ['Đang chờ', 'Queued'], running: ['Đang xử lý', 'Running'], completed: ['Hoàn tất', 'Completed'], partial: ['Báo cáo một phần', 'Partial report'], failed: ['Chưa hoàn tất', 'Failed'], cancelled: ['Đã dừng', 'Stopped'], interrupted: ['Bị gián đoạn', 'Interrupted'] };
  return labels[status]?.[vi ? 0 : 1] || (vi ? 'Chưa xác định' : 'Unknown');
}
export function stageLabel(stage: string, vi: boolean): string {
  if (stage === 'awaiting_input') return vi ? 'Đang chờ bạn trả lời' : 'Waiting for your answer';
  if (stage === 'resuming') return vi ? 'Tiếp tục với câu trả lời của bạn' : 'Continuing with your answer';
  const labels: Record<string, [string, string]> = { queued: ['Đang chờ', 'Queued'], starting: ['Chuẩn bị phiên', 'Preparing session'], replying: ['Trả lời trong phiên', 'Replying in session'], understand_brief: ['Hiểu yêu cầu', 'Understanding the brief'], collect_evidence: ['Tìm và đọc nguồn', 'Finding and reading sources'], assess_coverage: ['Đối chiếu bằng chứng', 'Reviewing evidence coverage'], draft_report: ['Viết phân tích', 'Writing analysis'], generate_visuals: ['Dựng hình theo bằng chứng', 'Building evidence-linked visuals'], audit_evidence: ['Kiểm chứng nội dung', 'Checking evidence'], improve_report: ['Bổ sung phần còn thiếu', 'Improving incomplete sections'], editorial: ['Kiểm tra bản viết', 'Editorial review'], finalize_report: ['Hoàn thiện báo cáo', 'Finalizing report'] };
  return labels[stage]?.[vi ? 0 : 1] || (vi ? 'Đang xử lý báo cáo' : 'Processing report');
}
export function errorLabel(code: string, vi: boolean): string {
  const errors: Record<string, [string, string]> = {
    conversation_busy: ['Phiên đang chạy hoặc đang chờ bạn trả lời. Dừng phiên và đợi xử lý kết thúc trước khi xóa.', 'This session is running or waiting for your answer. Stop it and wait for cleanup before deleting.'],
    conversation_cleanup_failed: ['Chưa dọn được dữ liệu phiên OpenCode. Cuộc trò chuyện vẫn được giữ; kiểm tra kết nối rồi thử xóa lại.', 'OpenCode session cleanup did not finish. The conversation is retained; check the connection and retry deletion.'],
    opencode_pdf_only: ['Muse hiện nhận PDF có chữ. Tệp khác hoặc ảnh dùng chế độ Chat.', 'Muse currently accepts readable PDFs. Use Chat mode for other files or images.'],
    opencode_fixed_model_required: ['Hội thoại OpenCode mới chỉ dùng Muse Spark 1.3 Free. Phiên cũ không tự đổi model.', 'New OpenCode conversations use only Muse Spark 1.3 Free. Existing sessions never switch models.'],
    opencode_question_invalid: ['Câu hỏi của agent chưa đúng cấu trúc. Lượt đã dừng; không tự trả lời thay bạn.', 'The agent question has an invalid structure. The run stopped; no answer was chosen for you.'],
    opencode_question_invalid_answer: ['Chọn đáp án hợp lệ hoặc nhập câu trả lời trước khi gửi.', 'Select valid options or enter an answer before submitting.'],
    opencode_question_limit: ['Agent đã hỏi quá nhiều trong lượt này. Lượt đã dừng; bạn có thể gửi yêu cầu rõ hơn.', 'The agent asked too many questions in this turn. The run stopped; send a more specific request.'],
    opencode_question_expired: ['Câu hỏi đã hết thời gian chờ hoặc lượt đã dừng. Lịch sử vẫn được giữ; gửi tin mới để tiếp tục.', 'The question expired or the run stopped. History is retained; send a new message to continue.'],
    attachment_empty: ['Tệp trống, hãy chọn tệp khác.', 'Empty file; select another file.'],
    attachment_too_large: ['Mỗi tệp tối đa 10 MB.', 'Each file must be at most 10 MB.'],
    attachment_count_limit: ['Tối đa 5 tệp, 3 ảnh và tổng cộng 20 MB cho một tin nhắn.', 'A message supports up to 5 files, 3 images and 20 MB total.'],
    attachment_unsupported_type: ['Loại tệp chưa hỗ trợ. Chọn PDF, DOCX, tệp chữ UTF-8 hoặc ảnh PNG/JPG/WebP.', 'Unsupported file type. Select PDF, DOCX, UTF-8 text or PNG/JPG/WebP images.'],
    attachment_invalid_document: ['Không đọc được tệp hoặc nội dung không khớp loại tệp. Tệp chữ cần UTF-8; PDF không được mã hóa.', 'Cannot read this file or its contents do not match the file type. Text requires UTF-8; PDFs must not be encrypted.'],
    attachment_invalid_image: ['Ảnh không hợp lệ hoặc quá lớn để giải mã an toàn.', 'Invalid image or dimensions exceed safe decoding limits.'],
    attachment_no_text: ['Không tìm thấy chữ trong tài liệu. PDF scan cần OCR; chat chưa tự OCR.', 'No readable text found. Scanned PDFs need OCR; chat does not automatically run OCR.'],
    attachment_image_not_supported: ['Model hiện tại chưa được xác nhận hỗ trợ đọc ảnh. Gỡ ảnh hoặc tạo hội thoại với model hỗ trợ; không tự đổi model.', 'The current model has no confirmed image support. Remove images or start a chat with a supported model; no automatic switch.'],
    attachment_not_found: ['Tệp không còn tồn tại hoặc bạn không có quyền đọc. Chọn và gửi lại tệp.', 'Attachment is unavailable or not owned by you. Select the file again.'],
    attachment_storage_limit: ['Đã đạt giới hạn lưu tệp của tài khoản. Gỡ tệp chưa gửi trước khi tải thêm.', 'Account attachment storage limit reached. Remove unsent attachments before uploading more.'],
    attachment_parser_busy: ['Bộ đọc tệp đang bận. Tệp chưa gửi đến model; thử lại sau.', 'File parser is busy. Nothing was sent to a model; try again later.'],
    opencode_not_configured: ['Chưa cấu hình worker OpenCode riêng. Xem hướng dẫn kết nối bên dưới.', 'Dedicated OpenCode worker is not configured. See connection instructions below.'],
    opencode_direct_disabled: ['Đường OpenCode trực tiếp đang tắt. Phiên được giữ nguyên, không tự chuyển sang đường khác.', 'Direct OpenCode is disabled. The session is retained; no transport switch.'],
    opencode_direct_not_installed: ['Chưa có OpenCode 1.19.0 và bộ bảo vệ trực tiếp trên server.', 'OpenCode 1.19.0 and its direct guard must be installed on the server.'],
    opencode_direct_guard_missing: ['Bộ bảo vệ trực tiếp chưa xác nhận được lượt gọi. Không lưu câu trả lời như một lượt thành công.', 'The direct guard did not confirm this call. It is not recorded as a successful response.'],
    opencode_direct_budget: ['Đã chạm ngân sách của lượt chat trực tiếp. Lịch sử được giữ; không tự gọi lại.', 'Direct chat budget reached. History is retained; no automatic replay.'],
    opencode_direct_timeout: ['OpenCode trực tiếp chưa hoàn tất trong thời hạn. Lượt đã dừng, không tự gửi lại.', 'Direct OpenCode exceeded the deadline. The run is stopped, not replayed.'],
    opencode_direct_tool_denied: ['Thao tác ngoài phạm vi nghiên cứu đã bị bộ bảo vệ chặn.', 'The guard blocked a tool action outside the research scope.'],
    opencode_direct_control_unavailable: ['Không xác nhận được quyền/ngân sách với server. Chưa gửi yêu cầu tiếp theo đến model.', 'Could not verify authorization/budget with the server. The next model request was not sent.'],
    opencode_direct_provider_unavailable: ['Không kết nối được dịch vụ model trực tiếp. Không tự chuyển provider hoặc gọi lại.', 'Direct provider connection failed. No provider switch or automatic retry.'],
    opencode_direct_chat_only: ['Bản thử trực tiếp chỉ hỗ trợ chat. Dùng mục Báo cáo cho pipeline báo cáo hiện tại.', 'The direct prototype is chat-only. Use Reports for the existing report pipeline.'],
    opencode_direct_model_changed: ['Model/provider trực tiếp không khớp phiên đã chọn. Lượt bị chặn, không tự đổi model.', 'Direct model/provider does not match this session. The call is blocked, not switched.'],
    opencode_direct_unauthorized: ['Quyền truy cập phiên trực tiếp không hợp lệ. Không gửi tiếp đến model.', 'Direct session authorization failed. No further model request was sent.'],
    opencode_direct_request_rejected: ['Bộ bảo vệ từ chối yêu cầu trực tiếp không hợp lệ.', 'The guard rejected an invalid direct request.'],
    opencode_provider_authentication: ['Dịch vụ OpenCode từ chối API key. Kiểm tra key phía server; không nhập key trong trình duyệt.', 'OpenCode rejected the API key. Check server configuration; never enter the key in the browser.'],
    opencode_model_not_allowed: ['Model của phiên chưa được bật trên server. Nhờ quản trị kiểm tra; không tự chuyển model.', 'This session’s model is not enabled on the server. Ask the administrator to check; no automatic switch.'],
    opencode_service_access_required: ['Worker đã kết nối, nhưng Nexora cần quyền API dịch vụ phù hợp. Model Free trong OpenCode desktop không mặc nhiên dùng được trên web. Quản trị cấu hình ở backend, không nhập key tại đây.', 'Worker is connected but Nexora needs appropriate service API access. Desktop Free models are not automatically available to this web app. Administrator configures this on the backend, never here.'],
    opencode_native_configuration: ['Chưa cấu hình được model/API Nexora cho OpenCode. Kiểm tra provider và API key đang dùng ở backend.', 'Configured Nexora model/API is unavailable to OpenCode. Check the backend provider and API key.'],
    opencode_configured_model_changed: ['Model/provider Nexora đã đổi so với phiên này. Tạo cuộc trò chuyện mới để chọn cấu hình mới; không tự chuyển model cho phiên cũ.', 'Configured Nexora model/provider changed. Create a new conversation to select it; existing sessions never switch silently.'],
    opencode_native_authentication: ['Nhà cung cấp model Nexora từ chối xác thực. Kiểm tra API key ở backend; không tự dùng provider khác.', 'Configured model authentication failed. Check the backend API key; no other provider is used.'],
    opencode_native_timeout: ['Model Nexora chưa trả lời trong thời hạn. Lịch sử được giữ; không tự gọi lại.', 'Configured model timed out. History is retained; no automatic replay.'],
    opencode_tool_history_unavailable: ['Thiếu metadata của lượt gọi công cụ trong phiên này. Không dựng lại ngữ cảnh giả; cần kiểm tra dữ liệu phiên hoặc tạo cuộc trò chuyện mới.', 'Tool-call metadata is missing. Context is not reconstructed speculatively; inspect session storage or create a new conversation.'],
    opencode_invalid_tool_history: ['Ngữ cảnh gọi công cụ không khớp dữ liệu đã lưu. Phiên được giữ lại để kiểm tra; không tự ghép lại dữ liệu.', 'Tool history does not match stored metadata. The session is retained for inspection; data is not reconstructed automatically.'],
    opencode_native_generation_failed: ['Model đang cấu hình chưa trả được nội dung hợp lệ. Không tự đổi model, provider hoặc gọi lại.', 'Configured model could not return valid content. No model/provider switch or automatic replay.'],
    opencode_configuration: ['Cấu hình kết nối OpenCode chưa hợp lệ.', 'Invalid OpenCode connection configuration.'],
    opencode_unreachable: ['Không kết nối được worker OpenCode. Phiên đã lưu không bị xóa.', 'OpenCode worker is unreachable. Your saved conversation is retained.'],
    opencode_authentication: ['Thông tin xác thực worker chưa đúng; liên hệ người quản trị.', 'Worker authentication failed; contact the administrator.'],
    opencode_worker_unsafe: ['Worker chưa dùng cấu hình cô lập và gateway giới hạn của Nexora.', 'Worker must use Nexora’s isolated, metered gateway profile.'],
    opencode_worker_busy: ['Worker đang xử lý một cuộc trò chuyện khác. Chưa chuyển sang model khác.', 'Worker is handling another conversation. No model switch was made.'],
    opencode_session_missing: ['Phiên OpenCode gốc không còn tồn tại. Không tự tạo phiên thay thế để che việc mất ngữ cảnh.', 'Original OpenCode session is missing. A replacement was not silently created.'],
    opencode_generation_failed: ['OpenCode chưa trả được nội dung hợp lệ. Có thể đã chạm giới hạn model hoặc ngân sách. Không tự thử lại.', 'OpenCode could not return valid content. Model capacity or budget may be exhausted. No automatic retry.'],
    opencode_public_sources_only: ['Model này chỉ dùng nguồn công khai. Không gửi PDF tải lên hoặc ghi chú riêng.', 'This model is public-sources-only. Do not send uploaded PDFs or private notes.'],
    opencode_capacity: ['Đã chạm giới hạn dịch vụ/model; không tự chuyển sang model trả phí.', 'Provider/model capacity reached; no paid-model fallback.'],
    opencode_free_tier_restricted: ['Dịch vụ OpenCode đang từ chối Free tier cho kết nối này. Key hợp lệ chưa bảo đảm quyền dùng model Free; không tự gọi lại, giả thông tin client hoặc chuyển sang model trả phí.', 'OpenCode rejected Free-tier access for this connection. A valid key does not guarantee Free-model eligibility; no automatic retry, client impersonation or paid fallback.'],
    opencode_provider_rejected: ['Dịch vụ model từ chối yêu cầu. Kiểm tra cấu hình/quyền truy cập ở backend; phiên được giữ lại.', 'Model provider rejected the request. Check backend configuration/access; the session is retained.'],
    conversation_archived: ['Hãy khôi phục cuộc trò chuyện trước khi gửi tin.', 'Restore this conversation before sending a message.'],
    worker_interrupted: ['Lượt chạy bị gián đoạn. Lịch sử được giữ; yêu cầu tính phí không tự chạy lại.', 'Run interrupted. History is retained; billable requests are not replayed.'],
    idempotency_conflict: ['Mã gửi đã được dùng cho nội dung khác. Hãy tạo lượt gửi mới.', 'This request ID was used for different content. Create a new turn.'],
    cancelled: ['Đã dừng lượt chạy.', 'Run stopped.'],
    message_required: ['Nhập nội dung tin nhắn.', 'Enter a message.'],
    report_topic_required: ['Nhập yêu cầu cho báo cáo hoặc chọn paper.', 'Enter a report brief or select a paper.'],
    external_data_consent_required: ['Cần xác nhận điều kiện dữ liệu của model trước khi tạo phiên.', 'Acknowledge model data handling before creating a session.'],
    language_conflict: ['Ngôn ngữ yêu cầu và lựa chọn báo cáo mâu thuẫn. Tạo phiên với Auto hoặc viết đúng ngôn ngữ đã chọn.', 'Requested and selected languages conflict. Create a session with Auto or use the selected language.'],
    report_unavailable: ['Chưa có báo cáo hoàn chỉnh; mở bản chẩn đoán để xem nguồn và phần còn thiếu.', 'No complete report is available; inspect the saved diagnostics and evidence gaps.'],
    conversation_daily_limit: ['Đã đạt giới hạn tạo cuộc trò chuyện trong ngày.', 'Daily conversation limit reached.'],
    turn_hourly_limit: ['Đã đạt giới hạn lượt chat trong giờ này.', 'Hourly conversation turn limit reached.'],
    research_generation_failed: ['Model chưa trả lời được (thường do API key, hết quota hoặc backend đang lạnh). Kiểm tra key/quota ở backend rồi gửi lại tin nhắn.', 'The model did not respond (usually an API key, quota or cold-backend issue). Check the backend key/quota, then send the message again.'],
    empty_response: ['Model trả về nội dung trống. Thử gửi lại tin nhắn ngắn gọn hơn.', 'The model returned an empty response. Try sending a shorter message again.'],
  };
  return errors[code]?.[vi ? 0 : 1] || (vi ? 'Chưa hoàn tất yêu cầu. Nội dung đã lưu được giữ lại; không tự gọi lại model.' : 'Request did not complete. Saved content is retained; no automatic model retry.');
}
export function policyLabel(policy: string, vi: boolean): string {
  const labels: Record<string, [string, string]> = {
    configured_provider: ['OpenCode dùng đúng provider/model Nexora đang cấu hình. Dữ liệu được gửi theo điều kiện của provider đó, không gửi sang Console/Free model và không tự đổi model khi lỗi.', 'OpenCode uses the configured Nexora provider/model. Its data terms apply; content is not sent to Console/Free models and errors never trigger a model switch.'],
    preview_zero_retention: ['Preview, miễn phí tạm thời; nhà cung cấp công bố không lưu/huấn luyện dữ liệu. Quyền gửi dữ liệu riêng vẫn do quản trị cấu hình.', 'Temporary free preview; provider publishes no retention/training. Private-data permission is still administrator-controlled.'],
    improvement_data: ['Nguồn công khai: dữ liệu có thể được dùng để cải thiện model.', 'Public sources: content may be used to improve the model.'],
    trial_no_confidential: ['Chỉ dùng thử; không gửi dữ liệu cá nhân hoặc bí mật.', 'Trial only; do not send personal or confidential data.'],
    training_data: ['Contributor: nội dung có thể được dùng để huấn luyện model.', 'Contributor: content may be used to train models.'],
  };
  return labels[policy]?.[vi ? 0 : 1] || (vi ? 'Chưa xác định chính sách dữ liệu.' : 'Data policy is unknown.');
}
