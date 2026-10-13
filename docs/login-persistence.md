# Ghi nhớ đăng nhập trong Nexora

Nexora không lưu mật khẩu Google/GitHub. Nhà cung cấp xác thực danh tính;
Nexora quản lý cookie phiên riêng, ký và HttpOnly.

## Trải nghiệm

- Không có checkbox trước đăng nhập hoặc popup hỏi ghi nhớ sau đăng nhập.
- Mỗi lần đăng nhập mới thành công (Google, GitHub hoặc tài khoản local),
  server tự tạo phiên persistent tối đa 30 ngày. Frontend không phải gửi thêm
  request bật ghi nhớ và không suy ra trạng thái từ URL callback.
- Trạng thái OAuth chưa xác thực vẫn chỉ dùng cookie phiên. Bắt đầu hoặc thất
  bại một luồng OAuth khác không tắt ghi nhớ của phiên đã đăng nhập.
- Mở lại trang/trình duyệt với cookie hợp lệ khôi phục tài khoản; không chạy
  OAuth lại. Đăng xuất thành công vẫn thoát tài khoản; không tự đăng nhập lại.
- Hồ sơ → Tài khoản & quyền truy cập cho phép bật/tắt ghi nhớ cho phiên hiện
  tại trên trình duyệt này. Tắt không đăng xuất ngay và không bị bật lại khi
  reload. Mỗi lần đăng nhập mới sẽ tự ghi nhớ theo mặc định.
- Đây không phải danh sách thiết bị hoặc tính năng đăng xuất từ xa.
- Trang đăng nhập và phần trợ giúp ghi rõ thời hạn và nhắc đăng xuất khi dùng
  xong trên máy dùng chung; không yêu cầu người dùng trả lời thêm một popup.

## Nâng cấp phiên cũ

Nguyên nhân popup lặp: phiên bản trước đặt `login_choice_pending=true` và
`remember=false` ở mỗi đăng nhập mới, dù lần đăng nhập trước đã chọn ghi nhớ.

- `GET /api/auth/me` chuyển một lần các phiên còn hợp lệ, đã xác thực và đang
  chờ lựa chọn sang persistent 30 ngày; trả `choice_pending=false` để tương
  thích client cũ. Frontend mới không chứa component popup.
- Lựa chọn đã hoàn tất được giữ nguyên: phiên đã ghi nhớ không bị đặt lại
  deadline; phiên đã chủ động tắt ghi nhớ không bị âm thầm bật khi reload.
- Không gia hạn hay khôi phục phiên hết hạn, cookie sai hoặc tài khoản bị khóa.
  Người dùng cần đăng nhập mới nếu cookie không còn hợp lệ.
- Field `choice_pending` được giữ trong API cho tương thích, không còn dùng
  để chặn hồ sơ hay Guided Tour.

## Thời hạn và an toàn

- Cookie persistent mặc định tối đa 30 ngày từ lúc đăng nhập thành công.
  Đọc API hoặc cập nhật hồ sơ không kéo dài deadline. Bật khi đã bật là
  idempotent. Tắt rồi bật lại bắt đầu deadline mới.
- Tắt ghi nhớ: thay cookie persistent bằng cookie phiên, server giới hạn
  tối đa 12 giờ. Đóng trình duyệt có thể kết thúc sớm hơn nhưng không bảo đảm:
  trình duyệt có thể khôi phục cookie phiên. Server vẫn kiểm tra deadline.
- Đăng xuất thành công xóa cookie trên trình duyệt này. Nếu API lỗi, UI báo
  lỗi thay vì giả vờ đã đăng xuất. Không đăng xuất tài khoản Google/GitHub.
- Chặn request đổi lựa chọn thiếu header `X-Nexora-Session-Intent: update`
  hoặc có Origin không được phép; boolean phải là boolean thật.
- API auth có `Cache-Control: private, no-store`. Không lưu credential hoặc
  profile trong localStorage; chỉ có tín hiệu ngẫu nhiên để tab khác tải lại
  trạng thái. Đồng bộ khi tab hoạt động/focus; mạng lỗi không tự đăng xuất.
- Cookie được ký, không được mã hóa. Hiện vẫn dùng kiến trúc signed-cookie
  của app: xóa cookie không thu hồi bản sao cookie đã bị đánh cắp. Quản lý
  thiết bị/thu hồi phiên từ server cần registry phiên riêng, không thuộc lượt này.
- Production cần HTTPS, `AUTH_COOKIE_SECURE=true`, secret mạnh và cấu hình
  `FRONTEND_URL` / `CORS_ORIGINS` đúng, không thêm origin không tin cậy.
  Đổi secret, xóa cookie, dùng trình duyệt khác hoặc chặn cookie có thể yêu cầu
  đăng nhập lại; ghi nhớ không có nghĩa là phiên tồn tại vĩnh viễn.

## Kiểm thử và phát hành

Backend: `python -m pytest tests/test_login_sessions.py tests/test_backend.py -q`.
Frontend: `npm run test:auth`, `npm run test:auth:browser`, `npm run build`.
Browser test dùng App thật và API giả lập trong bộ nhớ, không thao tác tài khoản
thật, không gọi Google/GitHub. Backend mock hai nhà cung cấp để kiểm tra callback;
việc xác thực OAuth live vẫn cần kiểm tra bằng tài khoản của chủ ứng dụng.

Khi phát hành cần cập nhật cả backend lẫn frontend và giữ ổn định session secret.
Chỉ cập nhật frontend sẽ ẩn popup nhưng backend cũ vẫn tạo cookie phiên ngắn hạn.
