# Ảnh và URL trong notebook

Editor Lĩnh vực và Dự án không còn cụm SocialToolbar (bạn bè/thông báo). Chia sẻ
trang, yêu thích, menu trang và các chức năng cộng tác khác được giữ nguyên.

## Cách dùng

- Ctrl+V ảnh từ clipboard; kéo ảnh vào vùng viết; hoặc dùng nút **Ảnh / Image**.
- Trong hộp thoại Ảnh, chọn tệp hoặc nhập URL ảnh HTTP(S) công khai.
- Dán một URL vào vị trí con trỏ trống để tạo thẻ liên kết, hoặc dùng
  **Liên kết URL / URL link** để đặt tên hiển thị. `/image` và `/url` cũng mở bộ chèn.
- Ảnh có chú thích và hộp xem lớn. Nội dung được lưu trong Yjs như các block
  `notebookImage` và `webLink`, không ghi lại toàn bộ trang dưới dạng HTML.
- Kéo thân ảnh/thẻ URL hoặc tay nắm sáu chấm để **di chuyển cả khối**, không
  kéo bản sao native của ảnh/link. ID khối, caption, nguồn ảnh và URL được giữ.
- Di chuột lên ảnh: chọn 25/50/75/100% ở **Kích thước / Size**, hoặc kéo tay
  nắm ở cạnh phải để tinh chỉnh. Tay nắm hỗ trợ phím mũi tên, Shift+mũi tên,
  Home/End. Chiều rộng được lưu theo phần trăm (25–100%), giữ tỉ lệ ảnh và thích
  nghi với màn hình nhỏ. Người chỉ xem không có quyền di chuyển/chỉnh kích thước.

PNG/JPEG/WebP tĩnh, tối đa 10 MB/ảnh, 20 megapixel, 3 ảnh mỗi thao tác.
Ảnh được xoay theo EXIF, chuẩn hóa WebP, giữ alpha, bỏ metadata và thu nhỏ về
khung tối đa 4096×4096. Giới hạn hiện tại: 100 MB ảnh/tài khoản, 40 ảnh mới/giờ;
upload/import cũng có giới hạn tần suất. Ảnh trùng nội dung của cùng người dùng
được dùng lại. Không có hỗ trợ GIF động/SVG hoặc iframe tùy ý.

## Quyền và an toàn

Ảnh là dữ liệu của trang, không phải link public. Upload/import cần quyền editor,
GET cần quyền đọc trang và binding ảnh; thu hồi quyền hoặc archive trang được
kiểm tra lại ở mỗi GET. URL dành cho export cũng yêu cầu người đăng nhập còn
được quyền xem ít nhất một trang chứa ảnh. Không gửi ảnh vào AI khi thêm ảnh.

URL ảnh được tải server-side qua `agent.documents.fetch_public`: DNS chỉ chấp
nhận IP global, kết nối tới IP đã kiểm tra, TLS theo hostname gốc, kiểm tra lại
từng redirect, không cookie/auth proxy. Có giới hạn byte và deadline (check giữa
redirect/chunk, cộng thời gian chờ mạng/DNS). HTML, URL có credentials và SVG bị
từ chối; lỗi trả mã an toàn, không lộ địa chỉ nội bộ hoặc response upstream.

URL thường là thẻ bấm mở HTTP(S), không tải thumbnail, HTML hoặc iframe từ host
bên ngoài; chặn javascript/data/file URL. Ảnh trong rich HTML tùy ý không tự tải:
dùng clipboard image, upload hoặc nhập URL ảnh rõ ràng.

Khi sao chép/duplicate/khởi tạo tài liệu, server kiểm tra quyền xem nguồn ảnh
trước khi cấp binding cho trang đích. Guess ID trong Yjs không cấp quyền xem.
Client cũng kiểm tra ảnh trong JSON import trước khi chèn; update bị từ chối
không được báo là đã lưu. Ảnh đã được chia sẻ hợp lệ sang trang khác vẫn còn ở
trang đó khi nguồn bị archive. Bytes/binding được giữ để Undo, phiên bản và copy
còn hoạt động; gỡ block không có nghĩa xóa vĩnh viễn ảnh khỏi kho lưu.

Upload chậm khi chuyển trang/đổi quyền/đóng hộp thoại không được chèn vào trang
khác. Đã tải nhưng chưa chèn có thể vẫn chiếm dung lượng; thử lại cùng ảnh sẽ
dùng lại nội dung, không nhân bản bytes. Không tự xóa lịch sử hoặc dữ liệu cũ.

## Kiểm thử

`tests/test_notebook_media.py`: private preview, viewer/editor/revoke, validation,
quota, URL/SSRF, copy/duplicate/source archive, atomic grant và live rejected-update repair.
`npm run test:notebook-media:browser`: component/editor/Yjs thật, clipboard/drop,
URL card/image import, kéo thân ảnh/URL và tay nắm sáu chấm không nhân bản, giữ
ID, Undo/Redo khôi phục đúng thứ tự, resize bằng
select/keyboard/pointer, tỉ lệ ảnh, caption/preview, reload/width, error, chuyển trang, viewer,
VI/EN, sáng/tối và mobile. API/transport/images đều tổng hợp, không tài khoản thật.

API/schema custom block được đối chiếu với code BlockNote 0.55 đã cài và
[Editor overview](https://www.blocknotejs.org/docs/reference/editor/overview),
[file panel](https://www.blocknotejs.org/docs/react/components/image-toolbar).
