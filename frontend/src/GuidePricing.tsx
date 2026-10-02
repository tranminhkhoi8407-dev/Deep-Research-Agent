import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Compass,
  Clock3,
  Database,
  FileCheck2,
  FlaskConical,
  Gauge,
  KeyRound,
  LibraryBig,
  ListChecks,
  LockKeyhole,
  Network,
  NotebookPen,
  Play,
  Search,
  SearchCheck,
  ServerCog,
  Shapes,
  ShieldCheck,
  Sigma,
  Sparkles,
  Users,
  WandSparkles,
  X,
} from 'lucide-react';
import type { AuthUser } from './Auth';
import type { AppView, Language } from './ProductViews';

type LearningView = 'guide' | 'pricing';
type GuideGroup = 'start' | 'workflow' | 'toolkit' | 'trust' | 'troubleshoot';
type BillingCycle = 'monthly' | 'annual';
type PlanId = 'free' | 'pro' | 'team';

interface LocalizedLesson {
  title: string;
  summary: string;
  duration: string;
  keywords: string[];
  sections: Array<{
    title: string;
    paragraphs: string[];
    steps?: string[];
    checks?: string[];
  }>;
}

interface GuideLesson {
  id: string;
  group: GuideGroup;
  icon: typeof Sparkles;
  target: AppView;
  vi: LocalizedLesson;
  en: LocalizedLesson;
}

const guideGroups: Record<Language, Record<GuideGroup, string>> = {
  vi: { start: 'Bắt đầu', workflow: 'Pipeline nghiên cứu', toolkit: 'Công cụ & dữ liệu', trust: 'Kiểm chứng & quản trị', troubleshoot: 'Xử lý sự cố' },
  en: { start: 'Get started', workflow: 'Research pipeline', toolkit: 'Tools & data', trust: 'Trust & governance', troubleshoot: 'Troubleshooting' },
};

const lessons: GuideLesson[] = [
  {
    id: 'quick-start', group: 'start', icon: Play, target: 'research',
    vi: { title: 'Bắt đầu trong 3 phút', summary: 'Từ một câu hỏi rõ ràng đến phiên research đầu tiên mà không cần hiểu toàn bộ hệ thống.', duration: '3 phút', keywords: ['bắt đầu', 'brief', 'research'], sections: [
      { title: 'Quy trình ngắn nhất', paragraphs: ['Mở mục Nghiên cứu, mô tả vấn đề cần trả lời và chọn độ sâu. Hệ thống sẽ tự tạo góc nhìn analyst, tìm nguồn, phỏng vấn và tổng hợp báo cáo.'], steps: ['Viết câu hỏi có đối tượng, phạm vi, thời gian và tiêu chí so sánh.', 'Chọn Tiêu chuẩn cho lần đầu; dùng 2 analyst để có phản biện.', 'Giữ Tự động duyệt nếu muốn pipeline chạy xuyên suốt.', 'Kiểm tra nguồn và audit trước khi dùng kết luận.'] },
      { title: 'Brief mẫu', paragraphs: ['“So sánh RAG và fine-tuning cho chatbot hỗ trợ nội bộ của doanh nghiệp 200 nhân sự tại Việt Nam, xét chất lượng, bảo mật, TCO và thời gian triển khai trong 12 tháng.”'], checks: ['Có quyết định cần hỗ trợ', 'Có tiêu chí đánh giá', 'Có phạm vi thời gian hoặc địa lý'] },
    ] },
    en: { title: 'Start in three minutes', summary: 'Move from a focused question to your first research session without learning every control.', duration: '3 min', keywords: ['start', 'brief', 'research'], sections: [
      { title: 'The shortest path', paragraphs: ['Open Research, describe the decision or question, and choose a depth. The workspace creates analyst perspectives, finds evidence, interviews each analyst, and edits a report.'], steps: ['State the subject, scope, time horizon, and comparison criteria.', 'Use Standard with two analysts for a balanced first run.', 'Keep Auto approve on for an uninterrupted pipeline.', 'Review sources and the audit before using a conclusion.'] },
      { title: 'Example brief', paragraphs: ['“Compare RAG and fine-tuning for an internal support assistant at a 200-person company in Vietnam, covering quality, security, TCO, and a 12-month implementation horizon.”'], checks: ['A decision is explicit', 'Evaluation criteria are named', 'Time or geographic scope is bounded'] },
    ] },
  },
  {
    id: 'write-a-brief', group: 'start', icon: NotebookPen, target: 'research',
    vi: { title: 'Viết research brief tốt', summary: 'Biến một chủ đề rộng thành câu hỏi có thể tìm nguồn, phản biện và kết luận.', duration: '6 phút', keywords: ['prompt', 'câu hỏi', 'phạm vi'], sections: [
      { title: 'Cấu trúc 5 thành phần', paragraphs: ['Brief tốt không chỉ là một chủ đề. Nó nêu quyết định cần hỗ trợ, đối tượng, tiêu chí, giới hạn và hình thức đầu ra mong muốn.'], steps: ['Mục tiêu: quyết định nào sẽ dùng báo cáo?', 'Đối tượng: công nghệ, thị trường, nhóm người hay hiện tượng nào?', 'Tiêu chí: chi phí, hiệu quả, rủi ro, chất lượng hoặc tính khả thi.', 'Giới hạn: thời gian, địa lý, ngành, quy mô và loại nguồn.', 'Đầu ra: bảng so sánh, khuyến nghị, roadmap hay literature review.'] },
      { title: 'Tránh câu hỏi mơ hồ', paragraphs: ['Thay “AI có tốt không?” bằng câu hỏi có baseline, use case và thước đo. Nếu chưa biết tiêu chí, yêu cầu agent đề xuất tiêu chí trước rồi kiểm chứng chúng bằng nguồn.'] },
    ] },
    en: { title: 'Write a strong research brief', summary: 'Turn a broad topic into a question the system can source, challenge, and conclude.', duration: '6 min', keywords: ['prompt', 'question', 'scope'], sections: [
      { title: 'Five-part structure', paragraphs: ['A strong brief is more than a topic. It names the decision, subject, criteria, boundaries, and expected output.'], steps: ['Objective: what decision will this report support?', 'Subject: which technology, market, population, or phenomenon?', 'Criteria: cost, impact, risk, quality, or feasibility.', 'Boundaries: time, geography, industry, scale, and source types.', 'Output: comparison matrix, recommendation, roadmap, or literature review.'] },
      { title: 'Avoid vague prompts', paragraphs: ['Replace “Is AI good?” with a question that names a baseline, use case, and metric. If criteria are unknown, ask the agent to propose and then validate them.'] },
    ] },
  },
  {
    id: 'depth-and-analysts', group: 'start', icon: Gauge, target: 'settings',
    vi: { title: 'Chọn độ sâu và số analyst', summary: 'Cân bằng độ sâu, thời gian chạy, lượng truy vấn và quota API.', duration: '5 phút', keywords: ['quick', 'standard', 'deep', 'quota'], sections: [
      { title: 'Ba mức độ sâu', paragraphs: ['Nhanh phù hợp để định hướng ban đầu. Tiêu chuẩn thêm nhiều truy vấn và góc nhìn. Chuyên sâu chạy hai vòng phỏng vấn, duyệt nguồn và audit báo cáo.'], checks: ['Nhanh: tóm lược có nguồn, chi phí thấp', 'Tiêu chuẩn: lựa chọn mặc định cho đa số brief', 'Chuyên sâu: quyết định quan trọng hoặc câu hỏi có tranh luận'] },
      { title: 'Số analyst', paragraphs: ['Một analyst tiết kiệm quota nhưng dễ bỏ sót góc nhìn. Hai analyst phù hợp cho phân tích cân bằng. Ba analyst nên dành cho câu hỏi liên ngành hoặc cần một vai trò phản biện riêng.'] },
    ] },
    en: { title: 'Choose depth and analysts', summary: 'Balance research depth, runtime, query volume, and API quota.', duration: '5 min', keywords: ['quick', 'standard', 'deep', 'quota'], sections: [
      { title: 'Three depth levels', paragraphs: ['Quick supports early orientation. Standard adds queries and perspectives. Deep runs two interview rounds, source review, and a report audit.'], checks: ['Quick: low-cost sourced overview', 'Standard: default for most briefs', 'Deep: important decisions or contested questions'] },
      { title: 'Analyst count', paragraphs: ['One analyst conserves quota but may miss perspectives. Two is a balanced default. Use three for interdisciplinary questions or a dedicated skeptical role.'] },
    ] },
  },
  {
    id: 'five-stage-pipeline', group: 'workflow', icon: Network, target: 'research',
    vi: { title: 'Hiểu pipeline 5 giai đoạn', summary: 'Đọc đúng trạng thái Chuẩn bị, Góc nhìn, Nghiên cứu, Tổng hợp và Hoàn tất.', duration: '7 phút', keywords: ['pipeline', 'stage', 'tiến trình'], sections: [
      { title: 'Ý nghĩa từng giai đoạn', paragraphs: ['Thanh tiến trình phản ánh node đang chạy, không phải phần trăm thời gian. Một bước tìm nguồn có thể lâu hơn nhiều bước biên tập.'], steps: ['Chuẩn bị: kiểm tra kết nối, tải profile và lập kế hoạch.', 'Góc nhìn: tạo nhóm analyst theo vai trò.', 'Nghiên cứu: sinh truy vấn, tìm nguồn và phỏng vấn.', 'Tổng hợp: viết section, introduction và conclusion.', 'Hoàn tất: chuẩn hóa citation, audit và lưu Markdown.'] },
      { title: 'Khi nào nên can thiệp', paragraphs: ['Nếu tắt Tự động duyệt, pipeline sẽ dừng ở bước duyệt analyst hoặc section. Hãy sửa vai trò khi nhóm thiếu góc nhìn, hoặc yêu cầu viết lại section khi bằng chứng chưa đủ.'] },
    ] },
    en: { title: 'Understand the five-stage pipeline', summary: 'Read Prepare, Perspectives, Research, Synthesis, and Complete correctly.', duration: '7 min', keywords: ['pipeline', 'stage', 'progress'], sections: [
      { title: 'What each stage means', paragraphs: ['The rail shows the active graph stage, not elapsed-time percentage. One search step can take longer than several writing steps.'], steps: ['Prepare: validate connectivity, load profile, and plan.', 'Perspectives: create role-specific analysts.', 'Research: generate queries, retrieve evidence, and interview.', 'Synthesis: write sections, introduction, and conclusion.', 'Complete: normalize citations, audit, and save Markdown.'] },
      { title: 'When to intervene', paragraphs: ['With Auto approve off, the pipeline pauses for analyst or section review. Revise roles when a viewpoint is missing, or request a rewrite when evidence is insufficient.'] },
    ] },
  },
  {
    id: 'review-analysts', group: 'workflow', icon: Users, target: 'research',
    vi: { title: 'Thiết kế và duyệt analyst', summary: 'Tạo các vai trò không trùng nhau và có một lane phản biện thực sự.', duration: '5 phút', keywords: ['analyst', 'góc nhìn', 'feedback'], sections: [
      { title: 'Một nhóm tốt trông như thế nào', paragraphs: ['Các analyst nên khác nhau về câu hỏi, loại nguồn và tiêu chuẩn kết luận; đổi tên vai trò nhưng giữ cùng lập luận không tạo thêm chiều sâu.'], checks: ['Một analyst tập trung bằng chứng chính', 'Một analyst tìm phản chứng và giới hạn', 'Nếu có analyst thứ ba, dùng góc nhìn triển khai, đạo đức hoặc kinh tế'] },
      { title: 'Feedback hiệu quả', paragraphs: ['Viết yêu cầu cụ thể như “thay analyst xu hướng bằng chuyên gia đánh giá causal evidence và ưu tiên nghiên cứu đối chứng”. Tránh feedback chung chung như “làm sâu hơn”.'] },
    ] },
    en: { title: 'Design and review analysts', summary: 'Create non-overlapping roles with a genuine counter-evidence lane.', duration: '5 min', keywords: ['analyst', 'perspective', 'feedback'], sections: [
      { title: 'What a strong team looks like', paragraphs: ['Analysts should differ in questions, source types, and decision standards. Renaming the same argument does not add depth.'], checks: ['One analyst maps supporting evidence', 'One actively seeks counterevidence and limitations', 'A third can cover implementation, ethics, or economics'] },
      { title: 'Useful feedback', paragraphs: ['Be concrete: “replace the trends analyst with a causal-evidence reviewer who prioritizes controlled studies.” Avoid generic requests such as “go deeper.”'] },
    ] },
  },
  {
    id: 'evidence-search', group: 'workflow', icon: SearchCheck, target: 'sources',
    vi: { title: 'Tìm nguồn và chấm chất lượng', summary: 'Hiểu Tavily, Wikipedia, lane nguồn ưu tiên và cách hệ thống loại nguồn yếu.', duration: '8 phút', keywords: ['nguồn', 'tavily', 'wikipedia', 'quality'], sections: [
      { title: 'Nguồn được dùng như thế nào', paragraphs: ['Tavily mở rộng truy vấn web; Wikipedia hỗ trợ định nghĩa và cross-check ban đầu. Domain workspace thêm các lane ưu tiên như arXiv, PubMed, standards hoặc nguồn chính thức.'], steps: ['Ưu tiên nguồn sơ cấp và tài liệu chính thức.', 'Dùng review có phương pháp để định vị đồng thuận.', 'Tách bằng chứng trực tiếp khỏi bài viết diễn giải.', 'Ghi rõ khoảng trống khi không có nguồn đủ mạnh.'] },
      { title: 'Điểm chất lượng không phải chân lý', paragraphs: ['Nhãn high/medium/low hỗ trợ sàng lọc nhưng không thay thế việc đọc thiết kế nghiên cứu, cỡ mẫu, xung đột lợi ích và khả năng áp dụng.'] },
    ] },
    en: { title: 'Search and score evidence', summary: 'Understand Tavily, Wikipedia, preferred evidence lanes, and weak-source filtering.', duration: '8 min', keywords: ['sources', 'tavily', 'wikipedia', 'quality'], sections: [
      { title: 'How sources are used', paragraphs: ['Tavily broadens web retrieval; Wikipedia supports definitions and early cross-checking. Field workspaces add preferred lanes such as arXiv, PubMed, standards, and official records.'], steps: ['Prefer primary and official sources.', 'Use systematic reviews to locate consensus.', 'Separate direct evidence from commentary.', 'State evidence gaps when strong sources are unavailable.'] },
      { title: 'Quality labels are not truth', paragraphs: ['High/medium/low labels aid triage but never replace reading study design, sample size, conflicts, and applicability.'] },
    ] },
  },
  {
    id: 'research-fields', group: 'toolkit', icon: Shapes, target: 'domains',
    vi: { title: 'Workspace theo lĩnh vực', summary: 'Dùng taxonomy, playbook và tiêu chuẩn bằng chứng riêng cho Toán, Lý, Hóa, Sinh và AI.', duration: '6 phút', keywords: ['lĩnh vực', 'math', 'physics', 'chemistry', 'biology', 'ai'], sections: [
      { title: 'Tại sao phải chọn lĩnh vực', paragraphs: ['Một câu hỏi vật lý và một câu hỏi thị trường cần loại nguồn, cách biểu diễn và tiêu chuẩn kết luận khác nhau. Lĩnh vực cung cấp context cho analyst chứ không khóa nội dung của bạn.'], steps: ['Chọn ngành gần nhất với câu hỏi.', 'Chọn category để thu hẹp thuật ngữ và lane nguồn.', 'Dùng playbook hoặc nhập brief riêng.', 'Chỉ đính kèm notebook/LaTeX khi chúng thực sự liên quan.'] },
      { title: 'Nguồn ưu tiên', paragraphs: ['Danh sách nguồn là hướng dẫn truy vấn, không bảo đảm mọi cơ sở dữ liệu đều có API hoặc quyền truy cập. Agent vẫn phải trích nguồn thực sự đã truy xuất.'] },
    ] },
    en: { title: 'Field-specific workspaces', summary: 'Use distinct taxonomies, playbooks, and evidence standards for Math, Physics, Chemistry, Biology, and AI.', duration: '6 min', keywords: ['fields', 'math', 'physics', 'chemistry', 'biology', 'ai'], sections: [
      { title: 'Why choose a field', paragraphs: ['A physics question and a market question require different sources, notation, and decision standards. A field supplies analyst context without restricting your topic.'], steps: ['Choose the closest discipline.', 'Select a category to narrow vocabulary and evidence lanes.', 'Use a playbook or write a custom brief.', 'Attach notebook or LaTeX only when relevant.'] },
      { title: 'Preferred sources', paragraphs: ['Source lists guide retrieval; they do not guarantee API availability or access rights. The agent must still cite sources it actually retrieved.'] },
    ] },
  },
  {
    id: 'latex-and-notes', group: 'toolkit', icon: Sigma, target: 'domains',
    vi: { title: 'LaTeX Lab và Research notebook', summary: 'Soạn công thức, ghi giả thuyết và đưa context vào brief một cách có kiểm soát.', duration: '6 phút', keywords: ['latex', 'notes', 'notebook', 'formula'], sections: [
      { title: 'LaTeX Lab', paragraphs: ['KaTeX hiển thị công thức ngay khi gõ. Hóa học hỗ trợ cú pháp mhchem. Bạn có thể chèn công thức vào note, sao chép hoặc tải file .tex.'], checks: ['Kiểm tra ý nghĩa ký hiệu, không chỉ cú pháp', 'Khai báo giả thiết và miền xác định', 'Không coi một công thức nhập tay là bằng chứng'] },
      { title: 'Notebook riêng theo lĩnh vực', paragraphs: ['Notebook, checklist và bản nháp LaTeX được tự động lưu trong trình duyệt. Chúng chỉ đi vào pipeline khi bạn chủ động bật tùy chọn đính kèm; backend luôn đánh dấu note là context chưa kiểm chứng.'] },
    ] },
    en: { title: 'LaTeX Lab and research notebook', summary: 'Compose notation, record hypotheses, and attach context deliberately.', duration: '6 min', keywords: ['latex', 'notes', 'notebook', 'formula'], sections: [
      { title: 'LaTeX Lab', paragraphs: ['KaTeX previews notation while you type, with mhchem syntax for Chemistry. Insert a formula into notes, copy it, or download a .tex file.'], checks: ['Verify meaning, not only syntax', 'State assumptions and domains', 'Never treat an entered equation as evidence'] },
      { title: 'A notebook for each field', paragraphs: ['Notes, checklists, and LaTeX drafts autosave in the browser. They enter the pipeline only when explicitly attached, and the backend labels them as unverified context.'] },
    ] },
  },
  {
    id: 'library-and-export', group: 'toolkit', icon: LibraryBig, target: 'reports',
    vi: { title: 'Thư viện, kho nguồn và xuất dữ liệu', summary: 'Đọc lại report, lọc theo lĩnh vực, tải Markdown và sao lưu workspace.', duration: '5 phút', keywords: ['library', 'export', 'markdown', 'backup'], sections: [
      { title: 'Thư viện báo cáo', paragraphs: ['Mỗi tài khoản có vùng báo cáo riêng. Bạn có thể tìm theo tiêu đề, lọc depth/lĩnh vực, mở nội dung, sao chép, tải Markdown hoặc xóa.'], steps: ['Dùng metadata domain/category để gom dự án.', 'Mở Kho nguồn để xem URL nào được dùng ở report nào.', 'Xuất backup JSON trong Cài đặt trước khi di chuyển máy chủ.'] },
      { title: 'Xóa và sao lưu', paragraphs: ['Xóa report là thao tác vĩnh viễn trên máy chủ. Hãy tải Markdown hoặc xuất backup trước khi dọn dữ liệu quan trọng.'] },
    ] },
    en: { title: 'Library, sources, and export', summary: 'Revisit reports, filter by field, download Markdown, and back up the workspace.', duration: '5 min', keywords: ['library', 'export', 'markdown', 'backup'], sections: [
      { title: 'Report library', paragraphs: ['Each account has a separate report area. Search titles, filter by depth or field, open content, copy, download Markdown, or delete.'], steps: ['Use field metadata to organize projects.', 'Open Sources to see which reports used each URL.', 'Export a JSON backup in Settings before moving a host.'] },
      { title: 'Deletion and backups', paragraphs: ['Deleting a report permanently removes it from the server. Download Markdown or export a backup first when the data matters.'] },
    ] },
  },
  {
    id: 'citations-and-audit', group: 'trust', icon: FileCheck2, target: 'reports',
    vi: { title: 'Đọc citation và evidence audit', summary: 'Kiểm tra một kết luận có thật sự được nguồn hỗ trợ hay chỉ được viết thuyết phục.', duration: '8 phút', keywords: ['citation', 'audit', 'claim', 'evidence'], sections: [
      { title: 'Ba lớp kiểm tra', paragraphs: ['Một citation tốt phải tồn tại, liên quan trực tiếp và đủ mạnh cho mức độ khẳng định. Có URL đúng nhưng không hỗ trợ claim vẫn là lỗi.'], steps: ['Mở URL và xác nhận tiêu đề/tác giả/ngày.', 'Tìm đoạn hỗ trợ đúng claim.', 'So sánh thiết kế nguồn với mức độ chắc chắn của câu.', 'Tìm nguồn độc lập hoặc phản chứng cho kết luận quan trọng.'] },
      { title: 'Audit trong chế độ Chuyên sâu', paragraphs: ['Deep mode dùng một lượt biên tập phản biện và validation citation xác định. Audit giảm lỗi nhưng không phải bảo đảm tuyệt đối; người dùng vẫn chịu trách nhiệm với quyết định tác động cao.'] },
    ] },
    en: { title: 'Read citations and evidence audits', summary: 'Check whether a conclusion is supported rather than merely persuasive.', duration: '8 min', keywords: ['citation', 'audit', 'claim', 'evidence'], sections: [
      { title: 'Three layers of review', paragraphs: ['A good citation must exist, directly support the claim, and be strong enough for the certainty expressed. A real URL can still fail to support a sentence.'], steps: ['Open the URL and verify title, author, and date.', 'Locate the passage supporting the claim.', 'Match source design to the sentence’s certainty.', 'Seek independent evidence or counterevidence for important conclusions.'] },
      { title: 'Audit in Deep mode', paragraphs: ['Deep mode adds a skeptical editing pass and deterministic citation validation. It reduces error but is not an absolute guarantee; users remain responsible for high-impact decisions.'] },
    ] },
  },
  {
    id: 'privacy-and-sessions', group: 'trust', icon: LockKeyhole, target: 'settings',
    vi: { title: 'Phiên đăng nhập và quyền riêng tư', summary: 'Biết dữ liệu nào ở trình duyệt, dữ liệu nào ở host và khi nào context được gửi đi.', duration: '6 phút', keywords: ['privacy', 'cookie', 'oauth', 'session'], sections: [
      { title: 'Phiên và OAuth', paragraphs: ['Google/GitHub token chỉ dùng trong callback để lấy hồ sơ và không được ghi vào database hay localStorage. Cookie phiên được ký, HTTP-only và mặc định kết thúc cùng phiên trình duyệt.'], checks: ['Chỉ bật lưu đăng nhập trên thiết bị tin cậy', 'Không đưa API key hoặc mật khẩu vào brief', 'Production phải dùng HTTPS và Secure cookie'] },
      { title: 'Dữ liệu cục bộ', paragraphs: ['Ngôn ngữ, cấu hình, notebook và LaTeX ở localStorage. Báo cáo, hồ sơ tài khoản và audit log nằm trên host. Dùng trang Cookies để xóa toàn bộ tùy chọn trình duyệt.'] },
    ] },
    en: { title: 'Sessions and privacy', summary: 'Understand browser data, host data, and when research context is transmitted.', duration: '6 min', keywords: ['privacy', 'cookie', 'oauth', 'session'], sections: [
      { title: 'Sessions and OAuth', paragraphs: ['Google/GitHub tokens are used only in the callback to retrieve a profile and are not written to the database or localStorage. The signed HTTP-only session cookie ends with the browser session by default.'], checks: ['Remember sign-in only on trusted devices', 'Never place API keys or passwords in a brief', 'Production requires HTTPS and Secure cookies'] },
      { title: 'Local data', paragraphs: ['Language, defaults, notebooks, and LaTeX stay in localStorage. Reports, accounts, and audit logs live on the host. Use the Cookies page to clear browser preferences.'] },
    ] },
  },
  {
    id: 'host-console', group: 'trust', icon: ServerCog, target: 'admin',
    vi: { title: 'Vận hành Host Console', summary: 'Quản lý member, license, report, audit log và tình trạng hệ thống an toàn.', duration: '7 phút', keywords: ['host', 'admin', 'license', 'members'], sections: [
      { title: 'Quyền Host', paragraphs: ['Chỉ email trong ADMIN_EMAILS được cấp Host; vai trò do server quyết định và đồng bộ ở mỗi lần truy cập. License Free/Pro/Team không tự tạo quyền Host.'], steps: ['Theo dõi sức khỏe OAuth, model và storage.', 'Dùng Members để gán license hoặc tạm khóa tài khoản.', 'Chỉ xóa report vi phạm sau khi đã xác minh chủ sở hữu.', 'Đọc Activity để truy vết thay đổi quản trị.'] },
      { title: 'Production checklist', paragraphs: ['Bật HTTPS, Secure cookie, CORS hẹp, session secret mạnh, backup SQLite/report và rate limit trước khi mở công khai.'] },
    ] },
    en: { title: 'Operate the Host Console', summary: 'Manage members, licenses, reports, audit logs, and system health safely.', duration: '7 min', keywords: ['host', 'admin', 'license', 'members'], sections: [
      { title: 'Host authority', paragraphs: ['Only addresses in ADMIN_EMAILS receive Host access; the server re-synchronizes roles. Free/Pro/Team licenses never grant Host privileges.'], steps: ['Monitor OAuth, model, and storage health.', 'Use Members to assign licenses or suspend accounts.', 'Verify ownership before removing a violating report.', 'Use Activity to trace administrative changes.'] },
      { title: 'Production checklist', paragraphs: ['Enable HTTPS, Secure cookies, narrow CORS, a strong session secret, backups, and rate limiting before public launch.'] },
    ] },
  },
  {
    id: 'quota-and-rate-limits', group: 'troubleshoot', icon: AlertCircle, target: 'settings',
    vi: { title: 'Quota, rate limit và chi phí model', summary: 'Nhận biết lỗi quota và giảm chi phí mà không làm report mất cấu trúc.', duration: '5 phút', keywords: ['quota', '429', 'rate limit', 'token'], sections: [
      { title: 'Dấu hiệu thường gặp', paragraphs: ['HTTP 429, resource exhausted hoặc kết nối đóng sau nhiều lượt model thường liên quan quota/rate limit. Lỗi có thể đến từ LLM hoặc dịch vụ search.'], steps: ['Chuyển sang Nhanh và 1 analyst.', 'Giảm số vòng/chủ đề quá rộng.', 'Kiểm tra dashboard quota của provider.', 'Chờ cửa sổ rate limit reset hoặc đổi model được cấu hình.'] },
      { title: 'Không nên làm', paragraphs: ['Không log hoặc gửi toàn bộ .env để nhờ hỗ trợ. Chỉ gửi thời gian, stage, mã lỗi và đoạn log đã che secret.'] },
    ] },
    en: { title: 'Quota, rate limits, and model cost', summary: 'Recognize quota failures and reduce cost without losing report structure.', duration: '5 min', keywords: ['quota', '429', 'rate limit', 'token'], sections: [
      { title: 'Common signals', paragraphs: ['HTTP 429, resource exhausted, or a connection closing after repeated model calls often indicates quota or rate limiting from either the LLM or search service.'], steps: ['Use Quick with one analyst.', 'Reduce rounds or narrow the topic.', 'Check the provider quota dashboard.', 'Wait for reset or select another configured model.'] },
      { title: 'What not to do', paragraphs: ['Never share the complete .env for support. Send only time, stage, error code, and a small redacted log excerpt.'] },
    ] },
  },
  {
    id: 'connection-errors', group: 'troubleshoot', icon: Database, target: 'settings',
    vi: { title: 'Backend offline và WebSocket đóng', summary: 'Phân biệt server chưa chạy, proxy sai và phiên nghiên cứu bị ngắt giữa chừng.', duration: '6 phút', keywords: ['backend', 'websocket', 'connection', 'offline'], sections: [
      { title: 'Kiểm tra theo thứ tự', paragraphs: ['Nhãn Backend offline chỉ cho biết health endpoint không trả lời. WebSocket đóng có thể do backend dừng, exception trong graph, proxy timeout hoặc máy ngủ.'], steps: ['Mở /health và xác nhận status ok.', 'Kiểm tra frontend 5173 và backend 8000 đang chạy.', 'Đọc log đúng thời điểm lỗi.', 'Khởi động lại cả hai dịch vụ sau khi sửa .env.', 'Thử brief ngắn ở chế độ Nhanh để tách lỗi cấu hình khỏi quota.'] },
      { title: 'Báo cáo chưa hoàn tất', paragraphs: ['Nếu kết nối đóng trước report_complete, giao diện không tự giả định báo cáo đã lưu. Hãy kiểm tra thư viện và log trước khi chạy lại để tránh tiêu quota hai lần.'] },
    ] },
    en: { title: 'Backend offline and closed WebSockets', summary: 'Separate a stopped server, bad proxy, and an interrupted research session.', duration: '6 min', keywords: ['backend', 'websocket', 'connection', 'offline'], sections: [
      { title: 'Check in order', paragraphs: ['Backend offline means the health endpoint did not answer. A closed WebSocket can result from a stopped backend, graph exception, proxy timeout, or sleeping device.'], steps: ['Open /health and confirm status ok.', 'Confirm frontend 5173 and backend 8000 are running.', 'Read logs at the failure timestamp.', 'Restart both services after editing .env.', 'Try a short Quick brief to separate configuration from quota.'] },
      { title: 'An incomplete report', paragraphs: ['Without report_complete the UI does not assume a report was saved. Check the library and logs before retrying to avoid duplicate API usage.'] },
    ] },
  },
  {
    id: 'oauth-redirects', group: 'troubleshoot', icon: KeyRound, target: 'settings',
    vi: { title: 'Sửa OAuth redirect mismatch', summary: 'Đặt chính xác callback cho Google và GitHub ở môi trường local hoặc production.', duration: '5 phút', keywords: ['oauth', 'google', 'github', 'redirect'], sections: [
      { title: 'Callback phải khớp tuyệt đối', paragraphs: ['Google/GitHub so sánh scheme, host, port và path. localhost khác 127.0.0.1; callback frontend khác callback backend.'], steps: ['Google: http://127.0.0.1:8000/api/auth/callback/google', 'GitHub: http://127.0.0.1:8000/api/auth/callback/github', 'FRONTEND_URL dùng cổng 5173; BACKEND_URL dùng cổng 8000.', 'Sau khi đổi .env, dừng và chạy lại app.'] },
      { title: 'Production', paragraphs: ['Dùng HTTPS và callback trên domain thật. Không bật wildcard redirect; cấu hình từng URL chính xác cho mỗi môi trường.'] },
    ] },
    en: { title: 'Fix OAuth redirect mismatch', summary: 'Configure exact Google and GitHub callbacks for local and production environments.', duration: '5 min', keywords: ['oauth', 'google', 'github', 'redirect'], sections: [
      { title: 'Callbacks must match exactly', paragraphs: ['Google and GitHub compare scheme, host, port, and path. localhost differs from 127.0.0.1; frontend callbacks differ from backend callbacks.'], steps: ['Google: http://127.0.0.1:8000/api/auth/callback/google', 'GitHub: http://127.0.0.1:8000/api/auth/callback/github', 'FRONTEND_URL uses 5173; BACKEND_URL uses 8000.', 'Restart the app after changing .env.'] },
      { title: 'Production', paragraphs: ['Use HTTPS and the real domain callback. Avoid wildcard redirects; register each environment URL explicitly.'] },
    ] },
  },
];

const guideCopy = {
  vi: {
    eyebrow: 'Hướng dẫn Nexora', title: 'Cẩm nang từ brief đến báo cáo có nguồn.',
    description: 'Bắt đầu nhanh, hiểu pipeline, dùng bộ công cụ khoa học và xử lý các lỗi thường gặp trong một nơi.',
    quick: 'Bắt đầu nhanh trong 3 phút', search: 'Tìm trong hướng dẫn (quota, citation, LaTeX, OAuth…)', popular: 'Chủ đề phổ biến:',
    toc: 'Mục lục', lessons: 'bài', noResults: 'Không tìm thấy bài phù hợp. Thử từ khóa ngắn hơn.',
    complete: 'Đánh dấu đã đọc', completed: 'Đã hoàn thành', progress: 'Tiến độ đọc', openTool: 'Mở công cụ liên quan',
    previous: 'Bài trước', next: 'Bài tiếp theo', keyChecks: 'Checklist áp dụng', steps: 'Các bước thực hiện',
    topics: ['Bắt đầu', 'Pipeline', 'Nguồn & citation', 'Lĩnh vực & LaTeX', 'Quota & lỗi kết nối'],
  },
  en: {
    eyebrow: 'Nexora guide', title: 'From a brief to a sourced report.',
    description: 'Quick starts, pipeline guidance, scientific tools, and practical troubleshooting in one place.',
    quick: 'Start in three minutes', search: 'Search the guide (quota, citations, LaTeX, OAuth…)', popular: 'Popular topics:',
    toc: 'Contents', lessons: 'lessons', noResults: 'No matching lesson. Try a shorter search term.',
    complete: 'Mark as read', completed: 'Completed', progress: 'Reading progress', openTool: 'Open related tool',
    previous: 'Previous', next: 'Next', keyChecks: 'Apply this checklist', steps: 'Steps',
    topics: ['Get started', 'Pipeline', 'Sources & citations', 'Fields & LaTeX', 'Quota & connections'],
  },
} as const;

function initialGuideLesson() {
  const match = window.location.hash.match(/^#\/guide\/([^/?]+)/);
  return match && lessons.some((lesson) => lesson.id === match[1]) ? match[1] : 'quick-start';
}

function loadGuideProgress() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem('deep-research-guide-progress') || '[]');
    return new Set<string>(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

export function learningViewFromHash(hash = window.location.hash): LearningView | null {
  if (/^#\/guide(?:\/|$)/.test(hash)) return 'guide';
  if (/^#\/pricing(?:\/|$)/.test(hash)) return 'pricing';
  return null;
}

export function GuidePage({ language, onNavigate, onOpenTour }: { language: Language; onNavigate: (view: AppView) => void; onOpenTour: () => void }) {
  const t = guideCopy[language];
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(initialGuideLesson);
  const [completed, setCompleted] = useState(loadGuideProgress);
  const selectedIndex = Math.max(0, lessons.findIndex((lesson) => lesson.id === selectedId));
  const selected = lessons[selectedIndex];
  const article = selected[language];
  const SelectedIcon = selected.icon;

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return lessons;
    return lessons.filter((lesson) => {
      const copy = lesson[language];
      return [copy.title, copy.summary, ...copy.keywords].join(' ').toLocaleLowerCase().includes(needle);
    });
  }, [query, language]);

  const chooseLesson = (id: string) => {
    setSelectedId(id);
    window.history.replaceState({}, '', `${window.location.pathname}#/guide/${id}`);
    window.scrollTo({ top: 420, behavior: 'smooth' });
  };

  const toggleComplete = () => {
    setCompleted((current) => {
      const next = new Set(current);
      if (next.has(selected.id)) next.delete(selected.id); else next.add(selected.id);
      window.localStorage.setItem('deep-research-guide-progress', JSON.stringify([...next]));
      return next;
    });
  };

  const applyTopic = (index: number) => {
    const searches: Record<Language, string[]> = {
      vi: ['bắt đầu', 'pipeline', 'nguồn citation', 'lĩnh vực latex', 'quota connection'],
      en: ['start', 'pipeline', 'sources citations', 'fields latex', 'quota connection'],
    };
    setQuery(searches[language][index]);
  };

  return (
    <div className="learning-page guide-page">
      <section className="learning-hero">
        <span className="learning-badge"><BookOpenCheck size={17} />{t.eyebrow}</span>
        <h1>{t.title}</h1><p>{t.description}</p>
        <button className="learning-quick" type="button" onClick={() => chooseLesson('quick-start')}><Play size={16} />{t.quick}<ArrowRight size={15} /></button>
        <button className="learning-quick guide-tour-launch" type="button" onClick={onOpenTour}><Compass size={16} />{language === 'vi' ? 'Tham quan tương tác' : 'Interactive product tour'}<ArrowRight size={15} /></button>
        <label className="guide-search"><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} /><kbd>/</kbd></label>
        <div className="guide-topics"><span>{t.popular}</span>{t.topics.map((topic, index) => <button type="button" key={topic} onClick={() => applyTopic(index)}>{topic}</button>)}</div>
      </section>

      <section className="guide-progress" aria-label={t.progress}>
        <div><span><ListChecks size={18} /></span><div><strong>{t.progress}</strong><small>{completed.size} / {lessons.length} {t.lessons}</small></div></div>
        <div className="guide-progress__bar"><i style={{ width: `${Math.round((completed.size / lessons.length) * 100)}%` }} /></div>
        <strong>{Math.round((completed.size / lessons.length) * 100)}%</strong>
      </section>

      <div className="guide-layout">
        <aside className="guide-toc">
          <header><span>{t.toc}</span><strong>{filtered.length} {t.lessons}</strong></header>
          {filtered.length === 0 ? <div className="guide-empty"><Search size={20} /><p>{t.noResults}</p><button type="button" onClick={() => setQuery('')}>{language === 'vi' ? 'Xóa tìm kiếm' : 'Clear search'}</button></div> :
            (Object.keys(guideGroups[language]) as GuideGroup[]).map((group) => {
              const groupLessons = filtered.filter((lesson) => lesson.group === group);
              if (!groupLessons.length) return null;
              return <section key={group}><h2>{guideGroups[language][group]}</h2>{groupLessons.map((lesson) => {
                const Icon = lesson.icon; const item = lesson[language];
                return <button type="button" key={lesson.id} className={selected.id === lesson.id ? 'is-active' : ''} onClick={() => chooseLesson(lesson.id)}><span><Icon size={16} /></span><div><strong>{item.title}</strong><small>{item.duration}</small></div>{completed.has(lesson.id) ? <CheckCircle2 size={15} /> : <ChevronRight size={15} />}</button>;
              })}</section>;
            })}
        </aside>

        <article className="guide-article">
          <header>
            <span className="guide-article__icon"><SelectedIcon size={24} /></span>
            <div><small>{guideGroups[language][selected.group]} · {String(selectedIndex + 1).padStart(2, '0')}</small><h2>{article.title}</h2><p>{article.summary}</p></div>
            <span className="guide-duration"><Clock3 size={14} />{article.duration}</span>
          </header>
          <div className="guide-article__body">
            {article.sections.map((section) => <section key={section.title}>
              <h3>{section.title}</h3>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.steps && <div className="guide-steps"><strong><WandSparkles size={16} />{t.steps}</strong><ol>{section.steps.map((step) => <li key={step}><span>{section.steps!.indexOf(step) + 1}</span><p>{step}</p></li>)}</ol></div>}
              {section.checks && <div className="guide-checks"><strong><FileCheck2 size={16} />{t.keyChecks}</strong>{section.checks.map((check) => <span key={check}><Check size={14} />{check}</span>)}</div>}
            </section>)}
          </div>
          <div className="guide-article__actions">
            <button type="button" className={completed.has(selected.id) ? 'is-complete' : ''} onClick={toggleComplete}>{completed.has(selected.id) ? <CheckCircle2 size={17} /> : <ListChecks size={17} />}{completed.has(selected.id) ? t.completed : t.complete}</button>
            {selected.target !== 'admin' && <button type="button" onClick={() => onNavigate(selected.target)}>{t.openTool}<ArrowRight size={16} /></button>}
          </div>
          <footer>
            <button type="button" disabled={selectedIndex === 0} onClick={() => chooseLesson(lessons[selectedIndex - 1].id)}><ArrowLeft size={15} />{t.previous}</button>
            <span>{selectedIndex + 1} / {lessons.length}</span>
            <button type="button" disabled={selectedIndex === lessons.length - 1} onClick={() => chooseLesson(lessons[selectedIndex + 1].id)}>{t.next}<ArrowRight size={15} /></button>
          </footer>
        </article>
      </div>
    </div>
  );
}

const pricingCopy = {
  vi: {
    eyebrow: 'Gói dịch vụ self-hosted', title: 'Chọn mức vận hành phù hợp với nghiên cứu của bạn.',
    description: 'Ba gói bám đúng license Free, Pro và Team trong Host Console. Giá là cấu hình tham khảo cho bản triển khai này; host là bên quyết định và cấp quyền.',
    monthly: 'Hàng tháng', annual: 'Hàng năm', save: 'Tiết kiệm 2 tháng', current: 'Gói hiện tại', recommended: 'ĐỀ XUẤT', perMonth: '/ tháng', perYear: '/ năm',
    start: 'Bắt đầu miễn phí', activation: 'Xem cách kích hoạt', comparison: 'So sánh chi tiết', comparisonHint: 'Quyền tính năng dưới đây là khung triển khai đề xuất; host cần cấu hình policy/quota tương ứng khi đưa lên production.',
    feature: 'Tính năng / tài nguyên', faq: 'Câu hỏi thường gặp', faqHint: 'Minh bạch về license, API quota và thanh toán trong bản self-hosted.',
    nextTitle: 'Bước tiếp theo cho', nextMember: 'Bản này chưa tích hợp checkout. Lựa chọn đã được lưu trên thiết bị; hãy liên hệ host để được gán license và ngày hết hạn.',
    nextHost: 'Bạn đang là Host. Mở avatar ở góc trên → Host Console → Members để gán license và ngày hết hạn; hệ thống không tự thu tiền.',
    openSettings: 'Mở cài đặt tài khoản', dismiss: 'Đóng',
    assurances: ['Free không cần thẻ', 'Host kiểm soát license', 'Không tự gia hạn'],
    deploymentNote: 'Không có giao dịch tài chính tự động', deploymentBody: 'Pricing là trang mô tả gói và luồng kích hoạt. Mọi thanh toán, hóa đơn, thuế và hoàn tiền phải được host tích hợp riêng trước khi bán thương mại.',
  },
  en: {
    eyebrow: 'Self-hosted service plans', title: 'Choose an operating tier for your research.',
    description: 'Three tiers map directly to Free, Pro, and Team licenses in the Host Console. Prices are deployment defaults; the host controls assignment and policy.',
    monthly: 'Monthly', annual: 'Annual', save: 'Save two months', current: 'Current plan', recommended: 'RECOMMENDED', perMonth: '/ month', perYear: '/ year',
    start: 'Start free', activation: 'View activation path', comparison: 'Detailed comparison', comparisonHint: 'The entitlements below are a recommended deployment framework; a production host must configure matching policy and quota enforcement.',
    feature: 'Feature / resource', faq: 'Frequently asked questions', faqHint: 'Clear answers about licenses, API quota, and payments in a self-hosted build.',
    nextTitle: 'Next step for', nextMember: 'This build has no checkout integration. Your selection was saved on this device; contact the host to assign a license and expiry.',
    nextHost: 'You are a Host. Open the avatar menu → Host Console → Members to assign a license and expiry; the system never charges automatically.',
    openSettings: 'Open account settings', dismiss: 'Dismiss',
    assurances: ['No card for Free', 'Host-controlled licenses', 'No automatic renewal'],
    deploymentNote: 'No automatic financial transaction', deploymentBody: 'Pricing documents plans and activation. Payments, invoices, taxes, and refunds require a separate host integration before commercial use.',
  },
} as const;

const plans = {
  vi: [
    { id: 'free' as const, title: 'Free', subtitle: 'Khám phá và thử nghiệm', description: 'Cho cá nhân chạy bản self-hosted với API key riêng và thư viện báo cáo cá nhân.', features: ['Research nhanh và tiêu chuẩn', '1 analyst cho mỗi phiên', 'Lĩnh vực, notebook và LaTeX', 'Thư viện report cá nhân'] },
    { id: 'pro' as const, title: 'Researcher Pro', subtitle: 'Nghiên cứu chuyên sâu', description: 'Cho researcher cần nhiều góc nhìn, audit nguồn và workflow dài hơn.', features: ['Bao gồm toàn bộ Free', 'Deep research và evidence audit', 'Tối đa 3 analyst song song', 'Ưu tiên hỗ trợ từ host'] },
    { id: 'team' as const, title: 'Team', subtitle: 'Phòng lab và tổ chức', description: 'Cho workspace nhiều thành viên cần quản trị, license và audit trail tập trung.', features: ['Bao gồm toàn bộ Pro', 'Host Console và member controls', 'License/expiry theo tài khoản', 'Audit log và quản lý report'] },
  ],
  en: [
    { id: 'free' as const, title: 'Free', subtitle: 'Explore and prototype', description: 'For individuals running a self-hosted build with their own API keys and personal library.', features: ['Quick and standard research', 'One analyst per session', 'Fields, notebook, and LaTeX', 'Personal report library'] },
    { id: 'pro' as const, title: 'Researcher Pro', subtitle: 'Deeper evidence work', description: 'For researchers who need multiple perspectives, evidence audits, and longer workflows.', features: ['Everything in Free', 'Deep research and evidence audit', 'Up to three parallel analysts', 'Priority host support'] },
    { id: 'team' as const, title: 'Team', subtitle: 'Labs and organizations', description: 'For multi-member workspaces needing centralized administration, licenses, and audit trails.', features: ['Everything in Pro', 'Host Console and member controls', 'Per-account license and expiry', 'Audit logs and report governance'] },
  ],
};

const comparisonRows = {
  vi: [
    ['Research nhanh', 'Có', 'Có', 'Có'], ['Research tiêu chuẩn', 'Có', 'Có', 'Có'], ['Deep research + audit', '—', 'Có', 'Có'],
    ['Analyst mỗi phiên', '1', 'Tối đa 3', 'Tối đa 3'], ['Domain toolkit & LaTeX', 'Có', 'Có', 'Có'], ['Thư viện report cá nhân', 'Có', 'Có', 'Có'],
    ['Quản lý thành viên', '—', '—', 'Có'], ['Gán license và expiry', '—', '—', 'Có'], ['Audit log quản trị', '—', '—', 'Có'],
    ['API/model cost', 'Người dùng/host chi trả', 'Người dùng/host chi trả', 'Tổ chức chi trả'],
  ],
  en: [
    ['Quick research', 'Yes', 'Yes', 'Yes'], ['Standard research', 'Yes', 'Yes', 'Yes'], ['Deep research + audit', '—', 'Yes', 'Yes'],
    ['Analysts per session', '1', 'Up to 3', 'Up to 3'], ['Field toolkit & LaTeX', 'Yes', 'Yes', 'Yes'], ['Personal report library', 'Yes', 'Yes', 'Yes'],
    ['Member administration', '—', '—', 'Yes'], ['License and expiry assignment', '—', '—', 'Yes'], ['Administrative audit log', '—', '—', 'Yes'],
    ['API/model cost', 'User/host funded', 'User/host funded', 'Organization funded'],
  ],
};

const faqs = {
  vi: [
    ['Giá đã bao gồm Gemini/Tavily chưa?', 'Chưa. Đây là phần mềm self-hosted và API key do người dùng hoặc host cấu hình. Chi phí provider tách khỏi license ứng dụng.'],
    ['License có tự động cấp sau khi bấm chọn gói không?', 'Không. Trang không giả lập checkout. Host cấp Free/Pro/Team và ngày hết hạn trong Host Console.'],
    ['Team có đồng nghĩa với quyền Host không?', 'Không. Quyền Host chỉ đến từ ADMIN_EMAILS. License Team và role Host là hai lớp độc lập.'],
    ['Có tự động gia hạn không?', 'Không có gia hạn hoặc thu tiền tự động trong code hiện tại. Host phải tích hợp billing riêng nếu cần.'],
    ['Đổi máy có mất license không?', 'Không nếu bạn đăng nhập cùng tài khoản và host giữ nguyên registry SQLite. Notebook cục bộ cần backup riêng vì nằm trong trình duyệt.'],
    ['Có thể thay đổi giá không?', 'Có. Host cấu hình giá hiển thị bằng biến môi trường frontend; điều khoản thương mại thực tế do host công bố.'],
  ],
  en: [
    ['Does the price include Gemini or Tavily?', 'No. This is self-hosted software and API keys are configured by the user or host. Provider usage is separate from the app license.'],
    ['Is a license assigned when I choose a plan?', 'No. The page does not pretend to run checkout. A Host assigns Free, Pro, or Team and an expiry in Host Console.'],
    ['Does Team grant Host access?', 'No. Host authority comes only from ADMIN_EMAILS. Team license and Host role are separate controls.'],
    ['Is renewal automatic?', 'There is no automatic renewal or charging in the current code. A host must integrate billing separately.'],
    ['Will changing devices remove my license?', 'Not when the same account and SQLite registry are retained. Browser-local notebooks require a separate backup.'],
    ['Can a host change displayed prices?', 'Yes. Display prices come from frontend environment variables; the host publishes the actual commercial terms.'],
  ],
};

function envPrice(key: 'VITE_PRO_MONTHLY_PRICE' | 'VITE_TEAM_MONTHLY_PRICE', fallback: number) {
  const value = Number(import.meta.env[key]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function formatVnd(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value);
}

export function PricingPage({ language, user, onNavigate, onNotify }: { language: Language; user: AuthUser; onNavigate: (view: AppView) => void; onNotify: (message: string) => void }) {
  const t = pricingCopy[language];
  const [cycle, setCycle] = useState<BillingCycle>('annual');
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(() => {
    const saved = window.localStorage.getItem('deep-research-plan-interest');
    return saved === 'pro' || saved === 'team' ? saved : null;
  });
  const proMonthly = envPrice('VITE_PRO_MONTHLY_PRICE', 149000);
  const teamMonthly = envPrice('VITE_TEAM_MONTHLY_PRICE', 499000);
  const prices: Record<PlanId, number> = { free: 0, pro: cycle === 'annual' ? proMonthly * 10 : proMonthly, team: cycle === 'annual' ? teamMonthly * 10 : teamMonthly };
  const currentPlan = user.license_type || 'free';

  const choosePlan = (plan: PlanId) => {
    if (plan === 'free') { onNavigate('research'); return; }
    window.localStorage.setItem('deep-research-plan-interest', plan);
    setSelectedPlan(plan);
    onNotify(language === 'vi' ? `Đã lưu lựa chọn ${plan.toUpperCase()} trên thiết bị.` : `${plan.toUpperCase()} selection saved on this device.`);
    window.setTimeout(() => document.getElementById('pricing-next-step')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 20);
  };

  return (
    <div className="learning-page pricing-page">
      <section className="learning-hero pricing-hero">
        <span className="learning-badge"><CircleDollarSign size={17} />{t.eyebrow}</span>
        <h1>{t.title}</h1><p>{t.description}</p>
        <div className="pricing-assurances">{t.assurances.map((item) => <span key={item}><Check size={14} />{item}</span>)}</div>
        <div className="billing-toggle" role="group" aria-label={language === 'vi' ? 'Chu kỳ giá' : 'Billing cycle'}>
          <button type="button" className={cycle === 'monthly' ? 'is-active' : ''} onClick={() => setCycle('monthly')}>{t.monthly}</button>
          <button type="button" className={cycle === 'annual' ? 'is-active' : ''} onClick={() => setCycle('annual')}>{t.annual}<em>{t.save}</em></button>
        </div>
      </section>

      <section className="pricing-grid" aria-label={language === 'vi' ? 'Các gói dịch vụ' : 'Service plans'}>
        {plans[language].map((plan) => {
          const isCurrent = currentPlan === plan.id;
          return <article key={plan.id} className={`${plan.id === 'pro' ? 'is-featured' : ''} ${isCurrent ? 'is-current' : ''}`}>
            {plan.id === 'pro' && <span className="pricing-popular">{t.recommended}</span>}
            <header><span>{plan.id === 'free' ? <Sparkles size={20} /> : plan.id === 'pro' ? <FlaskConical size={20} /> : <Users size={20} />}</span><div><h2>{plan.title}</h2><p>{plan.subtitle}</p></div></header>
            <div className="plan-price"><strong>{formatVnd(prices[plan.id], language)}</strong><span>{plan.id === 'free' ? '' : cycle === 'annual' ? t.perYear : t.perMonth}</span></div>
            {plan.id !== 'free' && cycle === 'annual' && <small className="plan-equivalent">≈ {formatVnd(prices[plan.id] / 12, language)} {t.perMonth}</small>}
            <p className="plan-description">{plan.description}</p>
            <ul>{plan.features.map((feature) => <li key={feature}><CheckCircle2 size={16} />{feature}</li>)}</ul>
            <button type="button" className={plan.id === 'pro' ? 'button button--primary' : 'button button--secondary'} onClick={() => choosePlan(plan.id)}>{plan.id === 'free' ? t.start : t.activation}<ArrowRight size={16} /></button>
            {isCurrent && <span className="current-plan"><BadgeCheck size={14} />{t.current}</span>}
          </article>;
        })}
      </section>

      {selectedPlan && <section className="pricing-next-step" id="pricing-next-step">
        <span><KeyRound size={24} /></span><div><small>{t.nextTitle}</small><h2>{selectedPlan === 'pro' ? 'Researcher Pro' : 'Team'}</h2><p>{user.role === 'admin' ? t.nextHost : t.nextMember}</p></div>
        <div>{user.role !== 'admin' && <button className="button button--primary" type="button" onClick={() => onNavigate('settings')}>{t.openSettings}<ArrowRight size={16} /></button>}<button type="button" onClick={() => setSelectedPlan(null)} aria-label={t.dismiss}><X size={17} /></button></div>
      </section>}

      <section className="pricing-comparison">
        <div className="learning-section-heading"><span>02</span><div><h2>{t.comparison}</h2><p>{t.comparisonHint}</p></div></div>
        <div className="comparison-scroll"><table><thead><tr><th>{t.feature}</th><th>Free</th><th>Researcher Pro</th><th>Team</th></tr></thead><tbody>{comparisonRows[language].map((row) => <tr key={row[0]}><th>{row[0]}</th>{row.slice(1).map((cell, index) => <td key={`${row[0]}-${index}`} className={cell === 'Có' || cell === 'Yes' ? 'is-yes' : ''}>{cell === 'Có' || cell === 'Yes' ? <><Check size={15} />{cell}</> : cell}</td>)}</tr>)}</tbody></table></div>
      </section>

      <section className="pricing-notice"><ShieldCheck size={22} /><div><strong>{t.deploymentNote}</strong><p>{t.deploymentBody}</p></div></section>

      <section className="pricing-faq">
        <div className="learning-section-heading"><span>03</span><div><h2>{t.faq}</h2><p>{t.faqHint}</p></div></div>
        <div>{faqs[language].map(([question, answer], index) => <details key={question} open={index === 0}><summary>{question}<ChevronRight size={17} /></summary><p>{answer}</p></details>)}</div>
      </section>
    </div>
  );
}
