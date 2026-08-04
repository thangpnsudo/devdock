# DevDock

> **Local-first developer workspace.**
> SSH. Clipboard. Library. Search. Synchronization.
> Everything you need. Nothing you don't.

DevDock reduces context switching for developers by bringing SSH, clipboard history,
commands, and search into one fast, focused desktop application. Your data stays on
your machine, and core features keep working fully offline.

🌐 **Website chính thức:** [https://devdock.io.vn](https://devdock.io.vn)

---

## Download DevDock

Tải phiên bản mới nhất cho hệ điều hành của bạn:

| OS | Installer | Architecture |
|----|-----------|--------------|
| Linux | [Tải .deb](LINK_SAP_BIET) | amd64 (x64) |
| macOS | [Tải .dmg](LINK_SAP_BIET) | Apple Silicon (arm64) / Intel (x64) |
| Windows | [Tải .exe](LINK_SAP_BIET) | x64 |

> Các bản này là phiên bản **pilot** — chưa phải bản chính thức trên website. Bản
> cài đặt được phát hành định kỳ để bạn trải nghiệm trước và đóng góp ý kiến giúp
> sản phẩm ngày càng tốt hơn.

### Hướng dẫn cài đặt

<details>
<summary>Linux (Debian / Ubuntu)</summary>

```bash
sudo apt install ./DevDock_<version>_amd64.deb
```

Mở **DevDock** từ menu ứng dụng.
</details>

<details>
<summary>macOS (Apple Silicon / Intel)</summary>

Mở file `.dmg` tương ứng với chip của bạn, kéo **DevDock** vào thư mục
**Applications**. Nếu macOS yêu cầu, hãy cho phép ứng dụng trong
**System Settings → Privacy & Security**.
</details>

<details>
<summary>Windows</summary>

Chạy file `.exe` và làm theo trình cài đặt, sau đó mở **DevDock** từ Start menu.
</details>

---

## Sản phẩm

DevDock giữ mọi thứ trong ngày làm việc của developer gần với công việc thực tế:
bớt tìm kiếm, bớt ghi nhớ, tăng tốc độ.

### Năm công cụ, một bộ nhớ làm việc

| Khu vực | Chức năng |
|---------|-----------|
| **Workspace terminals** | Sắp xếp các phiên làm việc local và remote quanh dự án, không phải dựng lại bố cục mỗi sáng. |
| **Clipboard memory** | Tự động lưu các đoạn sao chép, tìm lại dễ dàng, không mất thứ vừa copy. |
| **Command library** | Biến lệnh và snippet thành bộ công cụ dùng lại được. |
| **SSH connections** | Hosts, thông tin đăng nhập, phiên gần đây và terminal trong một luồng làm việc tập trung. |
| **Search everything** | Một ô tìm kiếm trên clipboard, lệnh, snippet và servers — chạy offline. |

### Kiến trúc

Local-first: giao diện React 19 + TypeScript trên nền core Rust (SQLite + FTS5 cho
lưu trữ local). Không cần tài khoản; dữ liệu nằm trên máy của bạn.

### Lộ trình

- **Đã có:** quy trình làm việc local-first cho cá nhân.
- **Đang phát triển:** thư viện command/snippet dùng chung cho team, cấu hình
  workspace quản lý tập trung, đồng bộ đám mây có mã hoá.

---

## Phản hồi

DevDock được xây dựng công khai, và ý kiến của bạn từ các bản pilot là điều quyết
định lộ trình phát triển. Chọn kênh phù hợp:

- 🐞 **Gặp lỗi trong bản pilot** — mở [Bug report](../../issues/new?template=bug_report.yml)
- 💡 **Ý tưởng / đề xuất tính năng** — mở [Feature request](../../issues/new?template=feature_request.yml)
- 📝 **Đánh giá ngắn** — mở [Pilot feedback](../../issues/new?template=pilot_feedback.yml) (chỉ mất ~2 phút)
- 💬 **Thảo luận mở** — tạo chủ đề trong [Discussions](../../discussions)

Khi báo lỗi, hãy kèm **phiên bản** (ở tên release) và **hệ điều hành + kiến trúc**
để chúng tôi sửa nhanh hơn.

---

## License

Các bản pilot là phần mềm xem trước dành cho mục đích đánh giá. Xem ghi chú của
từng release để biết thêm chi tiết.