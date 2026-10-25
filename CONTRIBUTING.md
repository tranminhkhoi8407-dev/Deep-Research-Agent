# Đóng góp cho Nexora Agent

Cảm ơn bạn muốn cải thiện dự án. Báo lỗi, đề xuất tính năng và pull request
đều được hoan nghênh.

## Trước khi tạo issue hoặc pull request

- Tìm issue hiện có để tránh tạo bản trùng.
- Với lỗi, ghi lại bước tái hiện, kết quả mong đợi/thực tế, hệ điều hành,
  phiên bản Python/Node/Docker liên quan và log đã xóa thông tin nhạy cảm.
- Không đăng `.env`, API key, OAuth secret, session cookie, reset link, database,
  report riêng tư hay file người dùng lên issue, pull request hoặc log công khai.
- Với lỗ hổng bảo mật, làm theo [SECURITY.md](SECURITY.md), không đăng chi tiết
  khai thác trong issue công khai.

## Chạy dự án

Đường chạy đầy đủ sau khi cấu hình `.env` là:

```bash
docker compose up --build -d
```

Để phát triển từ source, cài `lockfile/requirements.txt` cho runtime hoặc
`lockfile/requirements-dev.txt` nếu cần pytest; cài frontend bằng
`npm --prefix frontend ci`, rồi chạy API và Vite theo README. Dùng
`lockfile/requirements-studio.txt` nếu cần chạy LangGraph Studio. Không commit `.env`,
database, report, file upload hoặc build artifacts.

## Trước khi gửi pull request

- Giữ thay đổi tập trung và giải thích lý do trong mô tả PR.
- Cập nhật README/docs và `.env.example` nếu thêm cấu hình hoặc thay đổi hành vi.
- Chạy `python -m pytest tests/ -v` cho thay đổi backend và
  `npm --prefix frontend run build` cho thay đổi frontend khi môi trường cho
  phép. Ghi rõ nếu có bước chưa chạy được; không đưa secrets vào log.
- Không thay đổi mặc định deployment để gửi dữ liệu về backend của người khác.

Các đóng góp được cung cấp theo giấy phép MIT của repository.
