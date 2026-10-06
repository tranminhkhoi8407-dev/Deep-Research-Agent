import {
  Accessibility,
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Cookie,
  Database,
  FileClock,
  Fingerprint,
  History,
  Info,
  LifeBuoy,
  LockKeyhole,
  Network,
  Scale,
  SearchCheck,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { AppView, Health, Language } from './ProductViews';
import { BrandMark } from './BrandMark';

export const informationViews = [
  'privacy',
  'terms',
  'security',
  'cookies',
  'accessibility',
  'help',
  'changelog',
  'about',
] as const;

export type InformationView = (typeof informationViews)[number];

interface InformationSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  table?: {
    headers: string[];
    rows: string[][];
  };
}

interface InformationDefinition {
  eyebrow: string;
  title: string;
  summary: string;
  updated: string;
  highlights: string[];
  sections: InformationSection[];
  related: InformationView[];
}

interface InformationPageProps {
  view: InformationView;
  language: Language;
  health: Health;
  publicMode?: boolean;
  onBack: () => void;
  onNavigate: (view: AppView) => void;
  onNavigateInformation: (view: InformationView) => void;
  onResetPreferences?: () => void;
}

const viewIcons = {
  privacy: Fingerprint,
  terms: Scale,
  security: ShieldCheck,
  cookies: Cookie,
  accessibility: Accessibility,
  help: LifeBuoy,
  changelog: History,
  about: Info,
};

const labels = {
  vi: {
    back: 'Quay lại workspace',
    backToSignIn: 'Quay lại đăng nhập',
    contents: 'Trong trang này',
    updated: 'Cập nhật lần cuối',
    glance: 'Tóm tắt nhanh',
    related: 'Nội dung liên quan',
    operational: 'Thông tin vận hành',
    online: 'Backend đang hoạt động',
    offline: 'Backend đang ngoại tuyến',
    checking: 'Đang kiểm tra backend',
    localBuild: 'Bản self-hosted · Collaborative projects',
    reset: 'Đặt lại tùy chọn trình duyệt',
    resetHint: 'Đưa ngôn ngữ và cấu hình nghiên cứu về mặc định; không xóa tài khoản hoặc báo cáo.',
    openSettings: 'Mở cài đặt',
    startResearch: 'Bắt đầu nghiên cứu',
    pageNames: {
      privacy: 'Quyền riêng tư', terms: 'Điều khoản', security: 'Bảo mật', cookies: 'Cookie',
      accessibility: 'Khả năng truy cập', help: 'Trung tâm trợ giúp', changelog: 'Nhật ký thay đổi', about: 'Về sản phẩm',
    },
  },
  en: {
    back: 'Back to workspace',
    backToSignIn: 'Back to sign in',
    contents: 'On this page',
    updated: 'Last updated',
    glance: 'At a glance',
    related: 'Related information',
    operational: 'Operational information',
    online: 'Backend operational',
    offline: 'Backend offline',
    checking: 'Checking backend',
    localBuild: 'Self-hosted build · Collaborative projects',
    reset: 'Reset browser preferences',
    resetHint: 'Restores language and research defaults; it does not delete your account or reports.',
    openSettings: 'Open settings',
    startResearch: 'Start research',
    pageNames: {
      privacy: 'Privacy', terms: 'Terms', security: 'Security', cookies: 'Cookies',
      accessibility: 'Accessibility', help: 'Help center', changelog: 'Changelog', about: 'About',
    },
  },
} as const;

const pages: Record<Language, Record<InformationView, InformationDefinition>> = {
  vi: {
    privacy: {
      eyebrow: 'LEGAL & DATA',
      title: 'Chính sách quyền riêng tư',
      summary: 'Giải thích dữ liệu Nexora xử lý, nơi dữ liệu được lưu và các lựa chọn bạn có trong bản triển khai self-hosted này.',
      updated: '1 tháng 10, 2026',
      highlights: ['Không lưu access token OAuth', 'Không có cookie quảng cáo', 'Có thể xuất và xóa báo cáo'],
      related: ['cookies', 'security', 'terms'],
      sections: [
        { id: 'scope', title: '1. Phạm vi và đơn vị vận hành', paragraphs: ['Chính sách này áp dụng cho Nexora Workspace. Đây là phần mềm self-hosted: tổ chức hoặc cá nhân triển khai hệ thống là bên vận hành dữ liệu của phiên bản đó.', 'Trước khi đưa hệ thống lên production, host cần bổ sung tên pháp nhân, địa chỉ liên hệ và thời hạn lưu trữ phù hợp với khu vực pháp lý của mình.'] },
        { id: 'data', title: '2. Dữ liệu được xử lý', paragraphs: ['Ứng dụng chỉ xử lý dữ liệu cần thiết để xác thực, vận hành nghiên cứu và quản lý workspace.'], bullets: ['Hồ sơ đăng nhập: nhà cung cấp, mã tài khoản, tên, email, username và ảnh đại diện.', 'Hồ sơ do người dùng chỉnh sửa: tên hiển thị, giới thiệu, địa điểm, tổ chức, website và lĩnh vực quan tâm.', 'Dữ liệu vận hành: trạng thái tài khoản, vai trò, số lần và thời điểm đăng nhập, license và nhật ký quản trị.', 'Nội dung nghiên cứu: chủ đề, cấu hình phiên, nguồn tìm thấy, báo cáo Markdown và metadata liên quan.', 'Thư viện bài báo: paper đã lưu, trạng thái đọc, đánh dấu sao, bộ sưu tập và ghi chú nghiên cứu theo tài khoản.', 'Tùy chọn trình duyệt: ngôn ngữ, độ sâu nghiên cứu, số analyst, chế độ tự động duyệt, lĩnh vực đang chọn, notebook, checklist và công thức LaTeX.'] },
        { id: 'purpose', title: '3. Mục đích sử dụng', paragraphs: ['Dữ liệu được dùng để đăng nhập, phân quyền, chạy pipeline nghiên cứu, lưu thư viện báo cáo, khôi phục cài đặt và bảo vệ hệ thống.', 'Ứng dụng không dùng dữ liệu để tạo hồ sơ quảng cáo hoặc bán thông tin cá nhân.'] },
        { id: 'providers', title: '4. Dịch vụ bên thứ ba', paragraphs: ['Khi bạn chủ động sử dụng một tính năng, dữ liệu cần thiết có thể được gửi tới nhà cung cấp tương ứng. Chính sách riêng của từng nhà cung cấp cũng được áp dụng.'], bullets: ['Google hoặc GitHub: xác thực OAuth và trả về hồ sơ cơ bản.', 'Gemini: xử lý prompt, phân tích và tổng hợp nội dung nghiên cứu.', 'Tavily: xử lý truy vấn tìm kiếm và trả về nguồn web.', 'arXiv và Crossref: nhận từ khóa/lĩnh vực tìm kiếm bài báo và trả về metadata học thuật; ghi chú cá nhân không được gửi tới các nguồn này.', 'Wikipedia hoặc nguồn công khai khác: cung cấp nội dung tham khảo.'] },
        { id: 'storage', title: '5. Lưu trữ và thời hạn', paragraphs: ['Tài khoản và nhật ký quản trị được lưu trong SQLite của host. Báo cáo được lưu trong vùng dữ liệu theo tài khoản trên máy chủ. Paper đã lưu, bộ sưu tập và ghi chú đọc được lưu trong SQLite của host, tách theo tài khoản; ứng dụng không lưu PDF bài báo. Tùy chọn giao diện, lĩnh vực đang chọn, ghi chú nhanh trên thiết bị, checklist, bản nháp LaTeX, tiến độ Guide và gói đang quan tâm được lưu trong localStorage của trình duyệt. Trạng thái Guided Tour (tour, bước và trạng thái hoàn tất) được lưu theo tài khoản trong SQLite và có bản sao cục bộ để tiếp tục khi mất kết nối.', 'Ghi chú nhanh và công thức trong Fields chỉ được gửi khi bạn chủ động đính kèm vào Research hoặc xác nhận sao chép sang Research Notebook. Research Notebook theo tài khoản được lưu trên máy chủ và đồng bộ sang thiết bị khác theo quyền dự án/trang. Tiến độ Guide và gói quan tâm không được gửi tới backend; trạng thái Guided Tour được đồng bộ qua API đăng nhập. Phiên đăng nhập mặc định kết thúc cùng phiên trình duyệt. Chỉ khi chọn “Keep me signed in”, cookie mới có thời hạn tối đa 30 ngày. Thời hạn lưu tài khoản, log và báo cáo do host của bản triển khai quy định.'] },
        { id: 'collaboration', title: '6. Dự án và nội dung cộng tác', paragraphs: ['Các thay đổi editor chưa đồng bộ có bản dự phòng trong sessionStorage của tab, được xóa khi server xác nhận lưu hoặc phiên tab kết thúc.', 'Tên người dùng duy nhất, kết nối, lời mời, tư cách nhóm, dự án, cây trang, bình luận, mốc phiên bản, nhiệm vụ, metadata nguồn chung và các bản cập nhật chỉnh sửa đồng thời được lưu trong SQLite của host. Người được cấp quyền có thể đọc hoặc sửa nội dung theo vai trò; link trang tự nó không cấp quyền.', 'Ghi chú Fields trong trình duyệt, báo cáo cá nhân và ghi chú đọc paper không tự động chia sẻ. Chỉ khi bạn xác nhận sao chép vào trang/dự án chung, nội dung hoặc metadata được chọn mới hiển thị cho người có quyền. Lưu trữ không phải xóa vĩnh viễn; hãy liên hệ host nếu cần yêu cầu xóa dữ liệu cộng tác khỏi máy chủ.'] },
        { id: 'choices', title: '7. Lựa chọn và quyền của bạn', paragraphs: ['Bạn có thể trực tiếp chỉnh sửa trường hồ sơ cá nhân, tải báo cáo, xuất bản sao workspace, xóa từng báo cáo, xóa tùy chọn trình duyệt và đăng xuất bất kỳ lúc nào.', 'Email, avatar và danh tính OAuth vẫn do nhà cung cấp đăng nhập quản lý. Để yêu cầu truy cập hoặc xóa toàn bộ tài khoản và log máy chủ, hãy liên hệ host của bản triển khai. Một số log có thể cần được giữ lại vì an toàn hệ thống hoặc nghĩa vụ pháp lý.'] },
        { id: 'changes', title: '8. Thay đổi và liên hệ', paragraphs: ['Thay đổi quan trọng phải được ghi trong Changelog và ngày cập nhật của chính sách. Bản project chưa cấu hình email hỗ trợ công khai; host cần công bố kênh liên hệ trước khi cho người dùng bên ngoài truy cập.'] },
      ],
    },
    terms: {
      eyebrow: 'LEGAL', title: 'Điều khoản sử dụng',
      summary: 'Các nguyên tắc sử dụng Nexora, trách nhiệm với nội dung AI và giới hạn của một workspace nghiên cứu self-hosted.',
      updated: '29 tháng 9, 2026',
      highlights: ['Dùng hợp pháp và có trách nhiệm', 'Luôn kiểm tra đầu ra AI', 'Tuân thủ điều khoản nguồn bên thứ ba'],
      related: ['privacy', 'security', 'help'],
      sections: [
        { id: 'acceptance', title: '1. Chấp nhận điều khoản', paragraphs: ['Khi sử dụng workspace, bạn đồng ý tuân thủ các điều khoản này và chính sách của host đang vận hành hệ thống. Nếu không đồng ý, hãy ngừng sử dụng và đăng xuất.'] },
        { id: 'account', title: '2. Tài khoản và quyền truy cập', paragraphs: ['Bạn chịu trách nhiệm sử dụng đúng tài khoản OAuth của mình và bảo vệ thiết bị đăng nhập. Không chia sẻ phiên, giả mạo danh tính hoặc tìm cách vượt quyền.', 'Host có thể tạm khóa tài khoản khi phát hiện lạm dụng, rủi ro an toàn hoặc vi phạm chính sách. Quyền Host chỉ được cấp cho email cấu hình trong ADMIN_EMAILS.'] },
        { id: 'acceptable-use', title: '3. Sử dụng chấp nhận được', paragraphs: ['Không sử dụng hệ thống để xâm nhập, phát tán mã độc, thu thập dữ liệu trái phép, vi phạm quyền riêng tư, quyền sở hữu trí tuệ hoặc pháp luật hiện hành.'], bullets: ['Không gửi bí mật, mật khẩu, khóa API hoặc dữ liệu nhạy cảm không cần thiết vào prompt.', 'Tôn trọng robots.txt, điều khoản website nguồn và giới hạn API.', 'Không trình bày đầu ra AI như sự thật đã được xác minh khi chưa kiểm tra nguồn.'] },
        { id: 'ai-output', title: '4. Nội dung do AI tạo', paragraphs: ['Báo cáo có thể thiếu, sai hoặc dẫn nguồn chưa đủ mạnh. Điểm chất lượng và audit hỗ trợ đánh giá nhưng không phải bảo đảm tuyệt đối.', 'Bạn chịu trách nhiệm kiểm tra trích dẫn và dùng chuyên gia phù hợp trước các quyết định pháp lý, y tế, tài chính, an toàn hoặc tác động cao.'] },
        { id: 'ownership', title: '5. Dữ liệu và quyền sở hữu', paragraphs: ['Bạn giữ quyền đối với nội dung mình nhập và báo cáo tạo ra trong phạm vi pháp luật cho phép. Bạn cấp quyền xử lý kỹ thuật cần thiết để hệ thống thực hiện yêu cầu.', 'Nội dung nguồn vẫn thuộc chủ sở hữu tương ứng; trích dẫn không chuyển quyền sử dụng nội dung đó cho bạn.'] },
        { id: 'collaboration', title: 'Cộng tác và chia sẻ', paragraphs: ['Chỉ mời người bạn có quyền chia sẻ nội dung cùng xem. Thành viên nhóm và người được mời vào dự án hoặc trang sẽ thấy nội dung theo quyền được cấp. Kết nối bạn bè không tự cấp quyền đọc dữ liệu.', 'Khi sao chép ghi chú, báo cáo hay metadata paper cá nhân vào không gian chung, bạn xác nhận cho người có quyền tại đó tiếp cận bản sao. Việc thu hồi quyền không thể thu hồi các bản sao người khác đã tải xuống trước đó.'] },
        { id: 'availability', title: '6. Dịch vụ và giới hạn trách nhiệm', paragraphs: ['Workspace được cung cấp theo hiện trạng và phụ thuộc vào mô hình, API tìm kiếm, mạng và cấu hình của host. Không bảo đảm dịch vụ luôn liên tục hoặc mọi kết quả đều chính xác.', 'Host cần bổ sung điều khoản trách nhiệm, luật áp dụng và cơ chế giải quyết tranh chấp phù hợp trước khi cung cấp dịch vụ thương mại.'] },
        { id: 'changes', title: '7. Thay đổi điều khoản', paragraphs: ['Các thay đổi quan trọng phải được công bố cùng ngày hiệu lực. Việc tiếp tục sử dụng sau khi điều khoản mới có hiệu lực thể hiện sự chấp nhận trong phạm vi pháp luật cho phép.'] },
      ],
    },
    security: {
      eyebrow: 'TRUST CENTER', title: 'Tiêu chuẩn bảo mật',
      summary: 'Tổng quan minh bạch về các kiểm soát đã có trong code và những việc host bắt buộc phải hoàn thiện khi triển khai production.',
      updated: '29 tháng 9, 2026',
      highlights: ['Cookie ký và HTTP-only', 'Role do server quyết định', 'Secrets chỉ đọc từ môi trường'],
      related: ['privacy', 'cookies', 'changelog'],
      sections: [
        { id: 'identity', title: '1. Xác thực và phiên', paragraphs: ['Google/GitHub OAuth dùng callback đã cấu hình. Access token chỉ được dùng trong callback để lấy hồ sơ và không được ghi vào database hoặc localStorage.', 'Phiên nằm trong cookie có chữ ký, HTTP-only và SameSite=Lax. Cookie Secure được bật khi AUTH_COOKIE_SECURE=true; production phải dùng HTTPS và bật tùy chọn này.'] },
        { id: 'authorization', title: '2. Phân quyền', paragraphs: ['Backend kiểm tra phiên cho API báo cáo và kiểm tra vai trò Host cho API quản trị. Danh sách ADMIN_EMAILS là nguồn quyết định quyền Host; client không thể tự nâng vai trò.', 'Dữ liệu báo cáo được phân vùng theo user id đã chuẩn hóa để hạn chế truy cập chéo tài khoản.'] },
        { id: 'secrets', title: '3. Quản lý bí mật', paragraphs: ['API key, OAuth client secret và session secret phải ở biến môi trường, không đưa vào frontend hoặc commit vào Git.', 'Production bắt buộc đặt AUTH_SESSION_SECRET mạnh, giới hạn CORS_ORIGINS và bảo vệ file .env bằng quyền hệ điều hành phù hợp.'] },
        { id: 'data', title: '4. Bảo vệ dữ liệu', paragraphs: ['Ứng dụng giảm dữ liệu trong cookie xuống hồ sơ phiên tối thiểu và không lưu token nhà cung cấp. SQLite và thư mục report vẫn cần host áp dụng backup, mã hóa ổ đĩa, quyền file và chính sách giữ dữ liệu.', 'Hiện project chưa tuyên bố chứng nhận SOC 2, ISO 27001 hoặc kiểm thử xâm nhập độc lập.'] },
        { id: 'deployment', title: '5. Checklist production', paragraphs: ['Trước khi mở truy cập công khai, host cần hoàn thành tối thiểu các bước sau.'], bullets: ['Dùng HTTPS toàn phiên và bật AUTH_COOKIE_SECURE.', 'Đặt session secret riêng, dài và xoay vòng theo quy trình.', 'Cấu hình chính xác OAuth redirect URI và CORS origin.', 'Giới hạn ADMIN_EMAILS và kiểm tra lại danh sách định kỳ.', 'Thiết lập backup, log monitoring, rate limit và quy trình xử lý sự cố.'] },
        { id: 'reporting', title: '6. Báo cáo sự cố', paragraphs: ['Nếu nghi ngờ phiên bị lộ, hãy đăng xuất, thu hồi quyền OAuth tại nhà cung cấp và báo cho host. Bản project chưa có địa chỉ security công khai; host phải cấu hình kênh tiếp nhận trước production.'] },
      ],
    },
    cookies: {
      eyebrow: 'PRIVACY CONTROLS', title: 'Cookie và lưu trữ cục bộ',
      summary: 'Danh mục đầy đủ các dữ liệu trình duyệt mà workspace hiện dùng, mục đích và cách bạn kiểm soát chúng.',
      updated: '1 tháng 10, 2026',
      highlights: ['Không quảng cáo', 'Không analytics mặc định', 'Remember me là lựa chọn chủ động'],
      related: ['privacy', 'security', 'help'],
      sections: [
        { id: 'inventory', title: '1. Danh mục', paragraphs: ['Workspace chỉ dùng cookie thiết yếu cho xác thực và localStorage cho tùy chọn giao diện, lĩnh vực, công cụ nghiên cứu, tiến độ học, Guided Tour và gói đang quan tâm.'], table: { headers: ['Tên', 'Loại', 'Mục đích', 'Thời hạn'], rows: [['deep_research_session', 'HTTP-only cookie', 'Xác thực phiên và hồ sơ tối thiểu', 'Phiên trình duyệt hoặc tối đa 30 ngày khi opt-in'], ['deep-research-language', 'localStorage', 'Ngôn ngữ giao diện sau đăng nhập', 'Đến khi xóa'], ['deep-research-settings', 'localStorage', 'Độ sâu, số analyst, tự động duyệt', 'Đến khi xóa'], ['deep-research-active-domain', 'localStorage', 'Lĩnh vực nghiên cứu được chọn gần nhất', 'Đến khi xóa'], ['deep-research-domain-workspace', 'localStorage', 'Ghi chú nhanh trên thiết bị, checklist, category và bản nháp LaTeX', 'Đến khi xóa'], ['deep-research-guide-progress', 'localStorage', 'Các bài Guide đã đánh dấu hoàn thành', 'Đến khi xóa'], ['nexora-onboarding:<user id>', 'localStorage + SQLite', 'Tour, bước và trạng thái; đồng bộ theo tài khoản', 'Đến khi xóa dữ liệu cục bộ/tài khoản'], ['deep-research-plan-interest', 'localStorage', 'Gói trả phí user đang quan tâm; không phải giao dịch', 'Đến khi xóa']] } },
        { id: 'essential', title: '2. Cookie thiết yếu', paragraphs: ['Cookie phiên cần thiết để đăng nhập và phân quyền. Vì không dùng cho quảng cáo hoặc theo dõi, nó không có công tắc tắt trong khi vẫn đăng nhập được.', 'Nếu không chọn “Keep me signed in”, cookie không có Max-Age và kết thúc theo phiên trình duyệt.'] },
        { id: 'local', title: '3. Tùy chọn và bản nháp cục bộ', paragraphs: ['Ngôn ngữ, cấu hình nghiên cứu, ghi chú nhanh trên thiết bị, checklist và bản nháp LaTeX được lưu trên trình duyệt này; chúng không phải credential và không tự động đồng bộ sang thiết bị khác.', 'Nội dung ghi chú nhanh chỉ được gửi khi bạn đính kèm vào Research hoặc xác nhận chép vào Research Notebook. Notebook là bối cảnh chưa kiểm chứng, không phải bằng chứng.', 'Editor cộng tác giữ bản dự phòng chưa đồng bộ trong sessionStorage theo tài khoản và trang. Bản này được xóa khi server xác nhận lưu. Hãy chờ trạng thái đã đồng bộ hoặc xuất Markdown trước khi đóng tab.'], table: { headers: ['Tên', 'Loại', 'Mục đích', 'Thời gian'], rows: [['nexora-live-draft:<user>:<page> / nexora-block-draft:<user>:<page>', 'sessionStorage', 'Khôi phục thay đổi Markdown/khối chưa được server xác nhận', 'Đến khi xác nhận lưu hoặc phiên tab kết thúc']] } },
        { id: 'third-party', title: '4. Cookie bên thứ ba', paragraphs: ['Nexora không nhúng quảng cáo, pixel mạng xã hội hoặc analytics mặc định. Khi chuyển sang Google/GitHub để OAuth, trang của họ có thể dùng cookie theo chính sách riêng.'] },
        { id: 'controls', title: '5. Cách kiểm soát', paragraphs: ['Bạn có thể đăng xuất để xóa cookie phiên, bỏ chọn “Keep me signed in” ở lần đăng nhập tiếp theo, xóa dữ liệu site trong trình duyệt hoặc dùng nút bên dưới để đặt lại các tùy chọn giao diện.'] },
      ],
    },
    accessibility: {
      eyebrow: 'INCLUSIVE DESIGN', title: 'Tuyên bố khả năng truy cập',
      summary: 'Mục tiêu, biện pháp đã áp dụng và các giới hạn hiện biết của giao diện Nexora.',
      updated: '29 tháng 9, 2026',
      highlights: ['Điều hướng bằng bàn phím', 'Focus hiển thị rõ', 'Hỗ trợ giảm chuyển động'],
      related: ['help', 'changelog', 'about'],
      sections: [
        { id: 'commitment', title: '1. Cam kết', paragraphs: ['Mục tiêu của project là hỗ trợ WCAG 2.2 Level AA, nhưng hiện chưa hoàn thành đánh giá tuân thủ độc lập. Vì vậy project không tuyên bố đạt chứng nhận đầy đủ.'] },
        { id: 'measures', title: '2. Biện pháp hiện có', paragraphs: ['Giao diện dùng HTML ngữ nghĩa, nhãn điều khiển, trạng thái ARIA, focus-visible và màu trạng thái không phải tín hiệu duy nhất.'], bullets: ['Navigation và footer có tên vùng rõ ràng.', 'Có prefers-reduced-motion cho người muốn giảm chuyển động.', 'Bảng nguồn chuyển thành card có nhãn trên màn hình nhỏ.', 'Nút icon quan trọng có accessible label.'] },
        { id: 'compatibility', title: '3. Công nghệ và tương thích', paragraphs: ['Ứng dụng dựa trên HTML, CSS, JavaScript, SVG và WAI-ARIA. Nên dùng phiên bản hiện hành của Chrome, Edge, Firefox hoặc Safari với JavaScript bật.'] },
        { id: 'limitations', title: '4. Giới hạn đã biết', paragraphs: ['Nội dung Markdown do mô hình hoặc website nguồn tạo có thể không luôn có cấu trúc heading và alt text tối ưu. Trang OAuth của nhà cung cấp nằm ngoài quyền kiểm soát của project.', 'Các tổ hợp screen reader/trình duyệt chưa được kiểm thử toàn diện; host nên thực hiện audit với người dùng thật trước triển khai công khai.'] },
        { id: 'feedback', title: '5. Phản hồi', paragraphs: ['Nếu gặp rào cản truy cập, hãy gửi URL trang, thao tác đang thực hiện, trình duyệt và công nghệ hỗ trợ cho host. Host cần công bố kênh phản hồi và thời gian trả lời trước production.'] },
      ],
    },
    help: {
      eyebrow: 'SUPPORT', title: 'Trung tâm trợ giúp',
      summary: 'Hướng dẫn nhanh để đăng nhập, chạy một phiên nghiên cứu, kiểm tra báo cáo và xử lý các lỗi phổ biến.',
      updated: '1 tháng 10, 2026',
      highlights: ['Quy trình 5 bước', 'Khắc phục OAuth', 'Kiểm tra API và quota'],
      related: ['about', 'security', 'changelog'],
      sections: [
        { id: 'start', title: '1. Bắt đầu', paragraphs: ['Đăng nhập bằng Google, GitHub hoặc tài khoản local development. Chỉ chọn “Keep me signed in” trên thiết bị riêng.', 'Mở Nghiên cứu, mô tả câu hỏi và phạm vi, chọn độ sâu, số analyst, rồi bắt đầu. Chủ đề rõ ràng về đối tượng, khu vực và thời gian thường cho kết quả tốt hơn.'] },
        { id: 'workflow', title: '2. Hiểu quy trình', paragraphs: ['Pipeline lần lượt chuẩn bị, tạo góc nhìn, tìm bằng chứng, tổng hợp và hoàn tất. Khi tắt tự động duyệt, hệ thống có thể chờ feedback ở bước analyst hoặc dàn ý.', 'Báo cáo hoàn tất được lưu trong Library; Sources gom các nguồn đã dùng giữa nhiều báo cáo.'] },
{ id: 'collaboration', title: 'Dự án, nhóm và trang dùng chung', paragraphs: ['Mở Projects hoặc chọn “Mở Research Notebook” trong Fields. Nếu chưa đặt tên, bạn sẽ được chuyển đến Profile → Chỉnh sửa hồ sơ để lưu tên người dùng duy nhất không có @. Tên trùng sẽ bị từ chối; các thông tin hồ sơ khác không bắt buộc. Lưu xong quay lại đúng lĩnh vực hoặc link trang/dự án vừa mở. Đổi tên cũng thực hiện tại Profile. Tìm bạn bè bằng tên đó ở mục Kết nối; kết bạn không tự cấp quyền nội dung.', 'Tạo dự án cá nhân hoặc nhóm kín với nhiều dự án; chọn lĩnh vực và chuyên đề. Tạo trang cha/con, chèn khung nghiên cứu; gõ / để thêm khối, kéo tay nắm để sắp xếp, chọn chữ để định dạng. Bảng và LaTeX hiển thị trực tiếp trong trang. Trang Markdown cũ cần chọn chuyển đổi; bản gốc được giữ trong lịch sử. Người có quyền sửa có thể cùng gõ realtime.', 'Mời bằng tên người dùng ở cấp nhóm, dự án hoặc một trang. Người nhận cần chấp nhận trong Lời mời; quyền xem, bình luận, sửa và quản lý khác nhau. Chép link không tự cấp quyền. Người quản lý có thể hủy lời mời, đổi hoặc thu hồi vai trò.', 'Chờ “All changes synced” trước khi đóng tab. Mất kết nối tạm khóa sửa và thử kết nối lại; nội dung chưa xác nhận có bản dự phòng trong phiên tab. Có thể xuất Markdown/JSON, nhập bản sao JSON vào cuối trang sau xác nhận, lưu và khôi phục mốc phiên bản giữ cấu trúc khối. Phiên bản không thay thế backup của host.', 'Tasks quản lý việc và người phụ trách; Sources trong dự án là nguồn chung chủ động thêm vào. Sources ở thanh điều hướng vẫn là nguồn đã dùng trong báo cáo cá nhân. Ghi chú Fields, báo cáo và ghi chú đọc paper không tự chia sẻ.'] },
        { id: 'oauth', title: '3. Lỗi đăng nhập OAuth', paragraphs: ['Lỗi redirect_uri_mismatch nghĩa là URL callback trong Google/GitHub chưa trùng chính xác với BACKEND_URL của project. Kiểm tra cả protocol, hostname, port và path.', 'Nếu nút hiện “Not configured”, hãy kiểm tra Client ID/Secret trong .env và khởi động lại backend.'] },
        { id: 'research-errors', title: '4. Lỗi nghiên cứu', paragraphs: ['Nếu phiên đóng sớm hoặc model báo quota, kiểm tra log backend, GEMINI_API_KEY, model, giới hạn API và kết nối mạng. Chế độ Quick giúp kiểm tra đường truyền với ít request hơn.', 'Nếu nguồn ít, tăng độ sâu, mô tả câu hỏi cụ thể hơn và xác nhận TAVILY_API_KEY.'] },
        { id: 'diagnostics', title: '5. Thông tin nên gửi cho host', paragraphs: ['Gửi thời gian xảy ra lỗi, bước pipeline, thông báo trên màn hình và vài dòng log liên quan. Không gửi API key, cookie, OAuth secret hoặc toàn bộ file .env.'] },
      ],
    },
    changelog: {
      eyebrow: 'RELEASE NOTES', title: 'Nhật ký thay đổi',
      summary: 'Các thay đổi đáng chú ý của workspace, tập trung vào tính năng user nhìn thấy và thay đổi bảo mật.',
      updated: '1 tháng 10, 2026',
      highlights: ['Research Notebook dạng khối', 'LaTeX & nguồn có trích dẫn', 'Cùng gõ realtime'],
      related: ['about', 'security', 'help'],
      sections: [
        { id: 'v081', title: 'v0.8.1 · Research Notebook', paragraphs: ['Editor dạng khối với menu /, kéo thả, định dạng chữ, heading, danh sách, checklist, code, bảng và công thức LaTeX trực tiếp. Trang Markdown cũ chỉ chuyển đổi khi bạn chọn; bản gốc được giữ trong lịch sử.', 'Cây trang, sắp xếp cùng cấp và tìm kiếm tên/nội dung theo quyền. Cột Sources chèn metadata, liên kết trang và backlink; template riêng cho năm lĩnh vực. Chọn mục và nguồn để chuẩn bị brief, không tự chạy AI.', 'Xuất Markdown/JSON, nhập JSON vào cuối trang sau xác nhận, mốc phiên bản giữ cấu trúc khối. Cùng gõ realtime với presence; chưa có con trỏ từ xa, link công khai ẩn danh hoặc hạ tầng cộng tác phân tán.'] },
        { id: 'v080', title: 'v0.8.0 · Dự án nghiên cứu cộng tác', paragraphs: ['Thêm tên người dùng duy nhất, kết nối bạn bè, nhóm kín, dự án theo năm lĩnh vực, trang cha/con, lời mời có chấp nhận và chia sẻ riêng từng trang.', 'Editor Markdown dùng Yjs để cùng gõ realtime, hỗ trợ LaTeX, template, presence, bình luận, mốc phiên bản thủ công và xuất Markdown. Trạng thái đồng bộ dựa trên xác nhận lưu của server.', 'Thêm phân việc, nguồn chung, lịch sử hoạt động, đổi/thu hồi vai trò, hủy lời mời, chuyển quyền sở hữu, lưu trữ và khôi phục. Editor dạng khối được bổ sung trong v0.8.1.'] },
        { id: 'v070', title: 'v0.7.0 · Guided Product Tour', paragraphs: ['Thêm lời mời tham quan ở lần đăng nhập đầu tiên, tour tổng quan xuyên màn hình và các tour ngắn cho Research, Lĩnh vực, Thư viện và Host Console.', 'Tour có spotlight, điều hướng bằng bàn phím, tạm dừng/xem lại, hỗ trợ mobile và reduced motion. Tiến độ được đồng bộ theo tài khoản; tour không tự chạy research hoặc thực hiện thao tác quản trị.'] },
        { id: 'v060', title: 'v0.6.0 · Hồ sơ nghiên cứu cá nhân', paragraphs: ['Bổ sung Personal Hub mở từ avatar với lối tắt đến hồ sơ, báo cáo, lĩnh vực, tiến độ Guide, cài đặt và license.', 'Bổ sung trang hồ sơ có thể chỉnh sửa, thống kê report/nguồn, heatmap 12 tháng, cột mốc, bản đồ chuyên môn, tiến độ Guide và báo cáo gần đây; các trường hồ sơ được lưu theo tài khoản trong SQLite.'] },
        { id: 'v050', title: 'v0.5.0 · Guide & Pricing', paragraphs: ['Bổ sung Guide 15 bài có tìm kiếm, mục lục theo nhóm, deep link, checklist và tiến độ đọc cục bộ.', 'Bổ sung Pricing Free/Pro/Team, chu kỳ tháng/năm, bảng so sánh, FAQ và luồng kích hoạt minh bạch qua Host Console; chưa tích hợp thanh toán tự động.'] },
        { id: 'v040', title: 'v0.4.0 · Workspace & trust', paragraphs: ['Bổ sung footer nhiều cột, Information Center, Privacy, Terms, Security, Cookies, Accessibility, Help và About. Tất cả liên kết nội bộ có trạng thái điều hướng thật.', 'Thêm lựa chọn lưu đăng nhập: cookie mặc định theo phiên, chỉ tồn tại tối đa 30 ngày khi user opt-in. Cải thiện đăng nhập English, typography, responsive source cards và Host Console.'] },
        { id: 'research', title: 'Nexora pipeline', paragraphs: ['Bổ sung ba độ sâu, multi-analyst workflow, tìm kiếm đa nguồn, kiểm tra claim/source, audit báo cáo và lưu thư viện theo tài khoản.'] },
        { id: 'admin', title: 'Authentication & Host Console', paragraphs: ['Bổ sung Google/GitHub OAuth, cookie phiên ký, SQLite account registry, role Host dựa trên ADMIN_EMAILS, quản lý member/license, audit trail và health overview.'] },
      ],
    },
    about: {
      eyebrow: 'PRODUCT', title: 'Về Nexora',
      summary: 'Một workspace đọc nguồn theo câu hỏi, phân tích paper theo lĩnh vực và báo cáo có cấu trúc kèm dẫn chứng.',
      updated: 'Core v0.4.0',
      highlights: ['Evidence-first', 'Multi-agent', 'Self-hosted'],
      related: ['help', 'changelog', 'security'],
      sections: [
        { id: 'mission', title: '1. Mục tiêu', paragraphs: ['Nexora giúp biến câu hỏi mở thành quy trình minh bạch: lập kế hoạch, tạo góc nhìn, tìm nguồn, đối chiếu bằng chứng và viết báo cáo có trích dẫn.'] },
        { id: 'architecture', title: '2. Kiến trúc', paragraphs: ['Frontend React cung cấp workspace và thư viện. FastAPI quản lý auth, report và WebSocket. LangGraph điều phối đọc, đánh giá độ bao phủ, viết và kiểm tra; Tavily tìm URL, kho tài liệu dùng chung lưu PDF và nội dung công khai. Model sử dụng theo cấu hình host.'] },
        { id: 'principles', title: '3. Nguyên tắc sản phẩm', paragraphs: ['Nguồn phải gắn với luận điểm, người dùng phải nhìn thấy trạng thái pipeline và host phải kiểm soát quyền truy cập. Chất lượng quan trọng hơn việc tạo văn bản nhanh.'] },
        { id: 'status', title: '4. Trạng thái project', paragraphs: ['Đây là project self-hosted đang phát triển, không phải dịch vụ được chứng nhận hoặc có SLA mặc định. Mỗi host chịu trách nhiệm cấu hình, kiểm thử, chính sách và hỗ trợ người dùng của bản triển khai.'] },
      ],
    },
  },
  en: {
    privacy: {
      eyebrow: 'LEGAL & DATA', title: 'Privacy policy',
      summary: 'What Nexora processes, where data is stored, and the choices available in this self-hosted deployment.',
      updated: '1 October 2026',
      highlights: ['OAuth access tokens are not stored', 'No advertising cookies', 'Reports can be exported and deleted'],
      related: ['cookies', 'security', 'terms'],
      sections: [
        { id: 'scope', title: '1. Scope and operator', paragraphs: ['This policy applies to Nexora Workspace. The software is self-hosted: the person or organization deploying an instance is the operator of that instance.', 'Before a public production launch, the host should add its legal identity, contact channel, jurisdiction-specific legal basis, and retention schedule.'] },
        { id: 'data', title: '2. Data we process', paragraphs: ['The application processes data needed for authentication, research workflows, and workspace administration.'], bullets: ['Sign-in profile: provider, account ID, name, email, username, and avatar.', 'User-edited profile: display name, bio, location, organization, website, and research interests.', 'Operational data: account status, role, sign-in count and timestamps, license, and administrative audit events.', 'Research content: topics, session configuration, discovered sources, Markdown reports, and related metadata.', 'Paper library: saved papers, reading status, stars, collections, and account-scoped research notes.', 'Browser preferences: language, research depth, analyst count, auto-approval, selected field, notebooks, checklists, and LaTeX drafts.'] },
        { id: 'purpose', title: '3. How data is used', paragraphs: ['Data is used to authenticate, authorize, run research, maintain the report library, restore preferences, and protect the service.', 'The application does not sell personal data or build advertising profiles.'] },
        { id: 'providers', title: '4. Third-party services', paragraphs: ['When you use a feature, the necessary data may be sent to its provider and that provider’s policy also applies.'], bullets: ['Google or GitHub: OAuth authentication and basic profile data.', 'Gemini: prompt processing, analysis, and report synthesis.', 'Tavily: search queries and web-source results.', 'arXiv and Crossref: receive paper-search terms or fields and return scholarly metadata; personal notes are not sent to these providers.', 'Wikipedia and other public sources: reference content.'] },
        { id: 'storage', title: '5. Storage and retention', paragraphs: ['Accounts and audit events are stored in the host’s SQLite database. Reports are stored in per-account server directories. Saved papers, collections, and reading notes are stored in the host’s SQLite database, scoped to each account; the app does not store paper PDFs. Interface preferences, the selected field, device scratchpads, checklists, LaTeX drafts, Guide progress, and plan interest stay in browser localStorage. Guided Tour state (tour, step, and completion status) is stored per account in SQLite, with a local copy for offline continuity.', 'Device scratchpad and formula context reaches the backend only when you explicitly attach it to Research or confirm copying it into a Research Notebook. Account-scoped Research Notebooks are stored on the server and sync across devices according to project/page permissions. Guide progress and plan interest are not sent to the backend; Guided Tour state is synced through an authenticated API. Sign-in ends with the browser session by default. A cookie lasts up to 30 days only after “Keep me signed in” is selected. Server-side retention is set by the deployment host.'] },
        { id: 'collaboration', title: '6. Projects and collaboration data', paragraphs: ['Unacknowledged editor changes have a sessionStorage recovery copy, removed after server acknowledgement or when the tab session ends.', 'Unique usernames, connections, invitations, group memberships, projects, page trees, comments, manual snapshots, tasks, shared-source metadata, and live editing updates are stored in the host’s SQLite database. Authorized people may read or edit according to their roles; possessing a page link alone does not grant access.', 'Browser-local Fields notes, personal reports, and private paper-reading notes are not shared automatically. Only content or metadata you explicitly confirm copying into a shared page or project becomes visible to people with access there. Archiving is not permanent deletion; contact the host to request removal of server-side collaboration data.'] },
        { id: 'choices', title: '7. Your choices', paragraphs: ['You can directly edit personal-profile fields, download reports, export a workspace backup, delete individual reports, clear browser preferences, and sign out.', 'Email, avatar, and OAuth identity remain managed by your sign-in provider. Contact the deployment host to request access to or deletion of complete account and audit records. Some security or legally required records may need to be retained.'] },
        { id: 'changes', title: '8. Changes and contact', paragraphs: ['Material updates should appear in the Changelog and this policy’s update date. This project has no public support email configured; a host should publish one before inviting external users.'] },
      ],
    },
    terms: {
      eyebrow: 'LEGAL', title: 'Terms of use',
      summary: 'Rules for using Nexora, responsibility for AI output, and the limits of a self-hosted research workspace.',
      updated: '29 September 2026',
      highlights: ['Use lawfully and responsibly', 'Verify AI output', 'Respect third-party terms'],
      related: ['privacy', 'security', 'help'],
      sections: [
        { id: 'acceptance', title: '1. Acceptance', paragraphs: ['By using this workspace, you agree to these terms and the policies of the host operating your instance. If you do not agree, stop using it and sign out.'] },
        { id: 'account', title: '2. Accounts and access', paragraphs: ['Use your own OAuth account and protect the device where you sign in. Do not share sessions, impersonate others, or bypass authorization.', 'A host may suspend an account for abuse, security risk, or policy violations. Host access is limited to emails configured in ADMIN_EMAILS.'] },
        { id: 'acceptable-use', title: '3. Acceptable use', paragraphs: ['Do not use the system for intrusion, malware, unauthorized collection, privacy violations, intellectual-property abuse, or unlawful conduct.'], bullets: ['Do not submit passwords, API keys, secrets, or unnecessary sensitive data in prompts.', 'Respect source-site terms, robots directives, and API limits.', 'Do not present unverified AI output as established fact.'] },
        { id: 'ai-output', title: '4. AI-generated output', paragraphs: ['Reports can be incomplete, incorrect, or supported by weak sources. Quality scoring and audits assist review but do not guarantee accuracy.', 'Verify citations and consult qualified professionals before legal, medical, financial, safety, or other high-impact decisions.'] },
        { id: 'ownership', title: '5. Content and ownership', paragraphs: ['You retain rights in submitted content and generated reports to the extent permitted by law, while allowing the technical processing required to complete your request.', 'Source material remains owned by its respective rights holders; a citation does not grant reuse rights.'] },
        { id: 'collaboration', title: 'Collaboration and sharing', paragraphs: ['Invite only people with whom you are entitled to share the content. Group members and invited project or page collaborators can access content according to their assigned roles. A friend connection by itself never grants data access.', 'If you copy a personal note, report, or saved-paper metadata into a shared space, people with access there can see that copy. Revoking access cannot retract copies someone previously downloaded.'] },
        { id: 'availability', title: '6. Availability and liability', paragraphs: ['The workspace is provided as-is and depends on models, search APIs, networks, and host configuration. Continuous availability and fully accurate results are not guaranteed.', 'A commercial deployment must add jurisdiction-specific liability, governing-law, and dispute provisions.'] },
        { id: 'changes', title: '7. Changes', paragraphs: ['Material changes should be published with an effective date. Continued use after an update means acceptance only to the extent permitted by applicable law.'] },
      ],
    },
    security: {
      eyebrow: 'TRUST CENTER', title: 'Security practices',
      summary: 'A transparent view of controls implemented in code and the work a host must complete for a secure production deployment.',
      updated: '29 September 2026',
      highlights: ['Signed HTTP-only cookies', 'Server-authoritative roles', 'Environment-based secrets'],
      related: ['privacy', 'cookies', 'changelog'],
      sections: [
        { id: 'identity', title: '1. Authentication and sessions', paragraphs: ['Google/GitHub OAuth callbacks use provider tokens only to retrieve a profile; access tokens are not written to the database or localStorage.', 'Sessions use signed HTTP-only, SameSite=Lax cookies. Secure cookies require AUTH_COOKIE_SECURE=true; production must use HTTPS and enable it.'] },
        { id: 'authorization', title: '2. Authorization', paragraphs: ['The backend requires a session for report APIs and the Host role for administrative APIs. ADMIN_EMAILS is authoritative; the client cannot elevate its own role.', 'Report storage is namespaced using a normalized user ID to reduce cross-account access.'] },
        { id: 'secrets', title: '3. Secret management', paragraphs: ['API keys, OAuth client secrets, and session secrets belong in environment variables and must never ship to the frontend or Git.', 'Production requires a strong AUTH_SESSION_SECRET, narrow CORS_ORIGINS, and operating-system protection for the .env file.'] },
        { id: 'data', title: '4. Data protection', paragraphs: ['The session cookie contains only a normalized profile and never provider tokens. The host must still secure SQLite and report directories with backups, disk encryption, file permissions, and retention rules.', 'The project does not claim SOC 2, ISO 27001, or independent penetration-test certification.'] },
        { id: 'deployment', title: '5. Production checklist', paragraphs: ['Before public access, hosts should complete at least the following.'], bullets: ['Use HTTPS for the entire session and enable AUTH_COOKIE_SECURE.', 'Set a unique, long session secret and establish rotation procedures.', 'Configure exact OAuth redirect URIs and allowed CORS origins.', 'Restrict and periodically review ADMIN_EMAILS.', 'Add backups, monitoring, rate limiting, and an incident-response process.'] },
        { id: 'reporting', title: '6. Reporting an incident', paragraphs: ['If you suspect session compromise, sign out, revoke OAuth access at the provider, and notify the host. The project has no public security address configured; hosts should publish one before production.'] },
      ],
    },
    cookies: {
      eyebrow: 'PRIVACY CONTROLS', title: 'Cookies and local storage',
      summary: 'A complete inventory of browser-side data currently used by the workspace, why it exists, and how to control it.',
      updated: '1 October 2026',
      highlights: ['No advertising', 'No analytics by default', 'Remember me requires opt-in'],
      related: ['privacy', 'security', 'help'],
      sections: [
        { id: 'inventory', title: '1. Inventory', paragraphs: ['The workspace uses one essential authentication cookie and localStorage for interface, field, research-tool, learning-progress, Guided Tour, and plan-interest preferences.'], table: { headers: ['Name', 'Type', 'Purpose', 'Duration'], rows: [['deep_research_session', 'HTTP-only cookie', 'Authentication and minimal profile', 'Browser session, or up to 30 days after opt-in'], ['deep-research-language', 'localStorage', 'Authenticated interface language', 'Until cleared'], ['deep-research-settings', 'localStorage', 'Depth, analyst count, auto-approval', 'Until cleared'], ['deep-research-active-domain', 'localStorage', 'Most recently selected research field', 'Until cleared'], ['deep-research-domain-workspace', 'localStorage', 'Per-field device scratchpad, checklist, category, and LaTeX draft', 'Until cleared'], ['deep-research-guide-progress', 'localStorage', 'Guide lessons marked complete', 'Until cleared'], ['nexora-onboarding:<user id>', 'localStorage + SQLite', 'Account-scoped tour, step, and status', 'Until local/account data is removed'], ['deep-research-plan-interest', 'localStorage', 'Interested paid tier; not a transaction', 'Until cleared']] } },
        { id: 'essential', title: '2. Essential session cookie', paragraphs: ['The session cookie is required to sign in and enforce access controls. Because it is not advertising or tracking technology, it cannot be disabled while remaining signed in.', 'Without “Keep me signed in,” it has no Max-Age and ends with the browser session.'] },
        { id: 'local', title: '3. Local preferences and drafts', paragraphs: ['Language, research defaults, device scratchpads, checklists, and LaTeX drafts stay on this browser; they are not credentials and do not automatically sync to another device.', 'Device scratchpad content is sent only when you attach it to Research or confirm copying it into a Research Notebook. Notebook text is treated as unverified context, not evidence.', 'The collaboration editor keeps an unsynced recovery copy in sessionStorage, scoped to your account and page. It is removed after server acknowledgement. Wait for the synced status or export Markdown before closing the tab.'], table: { headers: ['Name', 'Type', 'Purpose', 'Duration'], rows: [['nexora-live-draft:<user>:<page> / nexora-block-draft:<user>:<page>', 'sessionStorage', 'Recover unacknowledged Markdown/block edits', 'Until acknowledged or the tab session ends']] } },
        { id: 'third-party', title: '4. Third-party cookies', paragraphs: ['Nexora embeds no advertising, social pixels, or analytics by default. Google and GitHub may set their own cookies when you leave the app for OAuth.'] },
        { id: 'controls', title: '5. Your controls', paragraphs: ['Sign out to clear the session cookie, leave “Keep me signed in” off next time, clear site data in your browser, or use the control below to reset interface preferences.'] },
      ],
    },
    accessibility: {
      eyebrow: 'INCLUSIVE DESIGN', title: 'Accessibility statement',
      summary: 'The accessibility target, current measures, and known limitations of the Nexora interface.',
      updated: '29 September 2026',
      highlights: ['Keyboard navigation', 'Visible focus', 'Reduced-motion support'],
      related: ['help', 'changelog', 'about'],
      sections: [
        { id: 'commitment', title: '1. Commitment', paragraphs: ['The project aims toward WCAG 2.2 Level AA, but has not completed an independent conformance assessment and does not claim full certification.'] },
        { id: 'measures', title: '2. Measures in place', paragraphs: ['The interface uses semantic HTML, form labels, ARIA state, visible focus, and redundant status cues.'], bullets: ['Navigation and footer regions have accessible names.', 'prefers-reduced-motion is respected.', 'Source tables become labeled cards on small screens.', 'Important icon-only buttons have accessible labels.'] },
        { id: 'compatibility', title: '3. Technology and compatibility', paragraphs: ['The application relies on HTML, CSS, JavaScript, SVG, and WAI-ARIA. Use a current Chrome, Edge, Firefox, or Safari release with JavaScript enabled.'] },
        { id: 'limitations', title: '4. Known limitations', paragraphs: ['Model- or source-generated Markdown may not always provide ideal headings or image alternatives. Provider OAuth pages are outside this project’s control.', 'Screen-reader/browser combinations have not been exhaustively tested; public deployments should include an audit with real users.'] },
        { id: 'feedback', title: '5. Feedback', paragraphs: ['When reporting a barrier, include the page URL, attempted task, browser, and assistive technology. A production host should publish a feedback channel and response target.'] },
      ],
    },
    help: {
      eyebrow: 'SUPPORT', title: 'Help center',
      summary: 'A quick guide to signing in, running research, reviewing reports, and resolving common failures.',
      updated: '1 October 2026',
      highlights: ['Five-stage workflow', 'OAuth troubleshooting', 'API and quota checks'],
      related: ['about', 'security', 'changelog'],
      sections: [
        { id: 'start', title: '1. Get started', paragraphs: ['Sign in with Google, GitHub, or the local development account. Select “Keep me signed in” only on a private device.', 'Open Research, define the question and scope, choose a depth and analyst count, then start. Questions with a clear audience, market, geography, and timeframe usually perform better.'] },
        { id: 'workflow', title: '2. Understand the workflow', paragraphs: ['The pipeline prepares context, creates perspectives, finds evidence, synthesizes, and completes. With auto-approval off, it can pause for analyst or outline feedback.', 'Completed reports appear in Library; Sources aggregates evidence used across reports.'] },
        { id: 'collaboration', title: 'Projects, groups, and shared pages', paragraphs: ['Open Projects or use “Open Research Notebook” in Fields. If you have not chosen a name, you will be sent to Profile → Edit profile to save a unique username without @. Duplicate names are rejected; all other profile details are optional. Saving returns you to the requested field or page/project link. Name changes also belong in Profile. Find friends by that name in Connections; friendship alone grants no content access.', 'Create a personal project or a private group with multiple projects; select a field and specialty. Add nested pages and field templates; type / to add blocks, drag handles to reorder, and select text to format. Tables and LaTeX display directly. Legacy Markdown pages convert only on request, preserving the original in history. People with editing access can type simultaneously.', 'Invite by username at group, project, or single-page level. Recipients accept in Invitations; viewing, commenting, editing, and managing are separate roles. Copying a link grants no access. Managers can cancel invitations and change or revoke roles.', 'Wait for “All changes synced” before closing. A disconnect temporarily locks editing and retries; unacknowledged changes have a tab-session recovery copy. Export Markdown/JSON, append a JSON backup after confirmation, and save or restore structured block snapshots. Snapshots do not replace host backups.', 'Tasks track work and assignees. Project Sources are explicitly shared references; the main Sources navigation still shows evidence used in personal reports. Fields notes, reports, and paper-reading notes are never shared automatically.'] },
        { id: 'oauth', title: '3. OAuth sign-in errors', paragraphs: ['redirect_uri_mismatch means the callback in Google/GitHub does not exactly match the project BACKEND_URL. Verify protocol, hostname, port, and path.', 'If a button says “Not configured,” check its Client ID/Secret in .env and restart the backend.'] },
        { id: 'research-errors', title: '4. Research failures', paragraphs: ['For early disconnects or quota errors, check backend logs, GEMINI_API_KEY, model access, API limits, and network connectivity. Quick mode is useful for low-cost connectivity checks.', 'For too few sources, increase depth, make the question more specific, and verify TAVILY_API_KEY.'] },
        { id: 'diagnostics', title: '5. What to send the host', paragraphs: ['Include the event time, pipeline stage, visible error, and a small relevant log excerpt. Never send API keys, cookies, OAuth secrets, or the complete .env file.'] },
      ],
    },
    changelog: {
      eyebrow: 'RELEASE NOTES', title: 'Changelog',
      summary: 'Notable workspace changes, focused on user-visible features and security behavior.',
      updated: '1 October 2026',
      highlights: ['Block-based Research Notebook', 'LaTeX & cited evidence', 'Simultaneous editing'],
      related: ['about', 'security', 'help'],
      sections: [
        { id: 'v081', title: 'v0.8.1 · Research Notebook', paragraphs: ['Block editor with a / menu, drag handles, text formatting, headings, lists, checklists, code, tables, and live LaTeX. Legacy Markdown pages convert only on request, preserving the original in history.', 'Nested page tree, sibling ordering, and permission-scoped title/content search. Sources insert metadata citations, page links, and accessible backlinks. Five field templates and selected-section brief preparation without automatically running AI.', 'Markdown/JSON export, confirmed JSON append import, and structured block snapshots. Simultaneous editing and presence are supported; remote cursors, anonymous public links, and distributed infrastructure are not included.'] },
        { id: 'v080', title: 'v0.8.0 · Collaborative research projects', paragraphs: ['Added unique usernames, friend connections, private groups, projects across five fields, nested pages, accepted invitations, and single-page sharing.', 'The Markdown editor uses Yjs for simultaneous editing with LaTeX, templates, presence, comments, manual snapshots, and Markdown export. Sync status follows server acknowledgement.', 'Added tasks, shared sources, activity history, role changes/revocation, invitation cancellation, ownership transfer, archive, and restore. The block editor was added in v0.8.1.'] },
        { id: 'v070', title: 'v0.7.0 · Guided Product Tour', paragraphs: ['Added a first-sign-in invitation, a cross-page overview, and focused tours for Research, Fields, Library, and Host Console.', 'Tours include spotlights, keyboard navigation, pause/replay, mobile and reduced-motion support. Progress syncs per account; tours never start research or perform administrative actions automatically.'] },
        { id: 'v060', title: 'v0.6.0 · Personal research profile', paragraphs: ['Added an avatar Personal Hub with shortcuts to profile, reports, research fields, Guide progress, settings, and licensing.', 'Added editable profile details, report/source metrics, a 12-month activity heatmap, milestones, expertise distribution, Guide progress, and recent reports; profile fields persist per account in SQLite.'] },
        { id: 'v050', title: 'v0.5.0 · Guide and Pricing', paragraphs: ['Added a searchable 15-lesson Guide with grouped contents, deep links, checklists, and browser-local reading progress.', 'Added Free/Pro/Team Pricing with monthly and annual views, a comparison matrix, FAQ, and an honest Host Console activation path; automatic payment is not integrated.'] },
        { id: 'v040', title: 'v0.4.0 · Workspace and trust', paragraphs: ['Added a multi-column footer and complete Information Center with Privacy, Terms, Security, Cookies, Accessibility, Help, Changelog, and About pages. Every internal footer item now has a working destination.', 'Added explicit session persistence: browser-session cookies by default and a maximum 30-day cookie only after opt-in. Improved the English login screen, typography, responsive source cards, and Host Console.'] },
        { id: 'research', title: 'Nexora pipeline', paragraphs: ['Added three depth levels, multi-analyst workflows, multi-source search, claim/source checks, report audits, and account-scoped report libraries.'] },
        { id: 'admin', title: 'Authentication and Host Console', paragraphs: ['Added Google/GitHub OAuth, signed sessions, an SQLite account registry, ADMIN_EMAILS-authoritative Host roles, member/license controls, an audit trail, and health overview.'] },
      ],
    },
    about: {
      eyebrow: 'PRODUCT', title: 'About Nexora',
      summary: 'An evidence-first workspace for question-driven reading, field-specific paper analysis, and structured reports with provenance.',
      updated: 'Core v0.4.0',
      highlights: ['Evidence-first', 'Multi-agent', 'Self-hosted'],
      related: ['help', 'changelog', 'security'],
      sections: [
        { id: 'mission', title: '1. Mission', paragraphs: ['Nexora turns an open question into a visible process: plan, create perspectives, discover sources, compare evidence, and write a cited report.'] },
        { id: 'architecture', title: '2. Architecture', paragraphs: ['The React frontend provides the workspace and library. FastAPI handles authentication, reports, and WebSockets. LangGraph coordinates reading, coverage, writing and checking. Tavily discovers URLs; the shared document store caches PDFs and public content. The model provider is host-configured.'] },
        { id: 'principles', title: '3. Product principles', paragraphs: ['Claims should connect to evidence, users should see pipeline state, and hosts should control access. Research quality matters more than producing text quickly.'] },
        { id: 'status', title: '4. Project status', paragraphs: ['This is an evolving self-hosted project, not a certified service with a default SLA. Each host is responsible for configuration, testing, policies, and user support for its deployment.'] },
      ],
    },
  },
};

export function informationViewFromHash(hash = window.location.hash): InformationView | null {
  const value = hash.replace(/^#\/?/, '').toLowerCase();
  return informationViews.includes(value as InformationView) ? value as InformationView : null;
}

export function InformationPage({
  view,
  language,
  health,
  publicMode = false,
  onBack,
  onNavigate,
  onNavigateInformation,
  onResetPreferences,
}: InformationPageProps) {
  const t = labels[language];
  const page = pages[language][view];
  const Icon = viewIcons[view];
  const healthLabel = health === 'online' ? t.online : health === 'offline' ? t.offline : t.checking;

  return (
    <div className="information-view">
      <header className="information-hero">
        <button className="information-back" type="button" onClick={onBack}>
          <ArrowLeft size={16} />{publicMode ? t.backToSignIn : t.back}
        </button>
        <div className="information-hero__content">
          <span className="information-icon" aria-hidden="true"><Icon size={26} /></span>
          <div>
            <span className="eyebrow">{page.eyebrow}</span>
            <h1>{page.title}</h1>
            <p>{page.summary}</p>
          </div>
        </div>
        <div className="information-meta"><FileClock size={15} /><span>{t.updated}: {page.updated}</span></div>
      </header>

      <div className="information-layout">
        <aside className="information-toc">
          <strong>{t.contents}</strong>
          <nav aria-label={t.contents}>
            {page.sections.map((section) => (
              <button key={section.id} type="button" onClick={() => document.getElementById(`info-${view}-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                {section.title}<ArrowRight size={13} />
              </button>
            ))}
          </nav>
        </aside>

        <article className="information-document">
          <div className="information-highlights" aria-label={t.glance}>
            {page.highlights.map((item) => <span key={item}><CheckCircle2 size={16} />{item}</span>)}
          </div>
          {page.sections.map((section) => (
            <section id={`info-${view}-${section.id}`} key={section.id}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.bullets && <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>}
              {section.table && (
                <div className="information-table-wrap">
                  <table>
                    <thead><tr>{section.table.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
                    <tbody>{section.table.rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={`${row[0]}-${section.table?.headers[index]}`}>{cell}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </section>
          ))}

          {view === 'cookies' && onResetPreferences && (
            <section className="information-action-card">
              <span><Settings2 size={20} /></span>
              <div><h2>{t.reset}</h2><p>{t.resetHint}</p></div>
              <button className="button button--secondary" type="button" onClick={onResetPreferences}>{t.reset}</button>
            </section>
          )}
          {view === 'help' && !publicMode && (
            <div className="information-actions">
              <button className="button button--primary" type="button" onClick={() => onNavigate('research')}><Sparkles size={17} />{t.startResearch}</button>
              <button className="button button--secondary" type="button" onClick={() => onNavigate('settings')}><Settings2 size={17} />{t.openSettings}</button>
            </div>
          )}
        </article>

        <aside className="information-rail">
          <section>
            <span><Network size={18} /></span>
            <div><strong>{t.operational}</strong><small className={`is-${health}`}>{healthLabel}</small><small>{t.localBuild}</small></div>
          </section>
          <section className="information-related">
            <strong>{t.related}</strong>
            {page.related.map((related) => {
              const RelatedIcon = viewIcons[related];
              return <a key={related} href={`#/${related}`} onClick={(event) => { event.preventDefault(); onNavigateInformation(related); }}><RelatedIcon size={16} />{t.pageNames[related]}<ArrowRight size={13} /></a>;
            })}
          </section>
          <section className="information-principle"><SearchCheck size={19} /><p>{language === 'vi' ? 'Chính sách mô tả hành vi hiện tại của code; host cần cập nhật khi cách xử lý dữ liệu thay đổi.' : 'Policies describe current code behavior; the host must update them when data practices change.'}</p></section>
        </aside>
      </div>
    </div>
  );
}

export function PublicInformationHeader({ language, onBack }: { language: Language; onBack: () => void }) {
  return (
    <header className="public-info-header">
      <button className="brand brand-button" type="button" onClick={onBack}>
        <span className="brand-mark"><BrandMark size={40} /></span>
        <span><strong>Nexora</strong><small>Evidence-first workspace</small></span>
      </button>
      <button className="button button--secondary" type="button" onClick={onBack}><ArrowLeft size={16} />{labels[language].backToSignIn}</button>
    </header>
  );
}

export function PublicInformationFooter({ language, onNavigateInformation }: { language: Language; onNavigateInformation: (view: InformationView) => void }) {
  const t = labels[language];
  const links: InformationView[] = ['privacy', 'terms', 'cookies', 'security', 'accessibility'];
  return (
    <footer className="public-info-footer">
      <span>© {new Date().getFullYear()} Nexora Workspace</span>
      <nav aria-label={t.related}>{links.map((view) => <a key={view} href={`#/${view}`} onClick={(event) => { event.preventDefault(); onNavigateInformation(view); }}>{t.pageNames[view]}</a>)}</nav>
    </footer>
  );
}
