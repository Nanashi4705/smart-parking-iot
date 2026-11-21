# Hệ thống Bãi Đỗ Xe Thông Minh (Smart Parking IoT)

Dự án IoT hoàn chỉnh gồm **2 board ESP32 DevKit + 2 board ESP8266 NodeMCU**, **Backend Node.js + SQLite + MQTT Broker nhúng**, và **Mobile App React Native (Expo Go)** dùng chung cho cả **Người dùng** và **Người điều hành**.

## Kiến trúc tổng thể

```text
[2x Node Tầng ESP8266] ──(ESP-NOW)──┐
   (4x HC-SR04 + 4x LED)            ├──► [Node Gateway ESP32] ──(Wi-Fi / MQTT :1883)──► [Backend Node.js]
[1x Node Cổng ESP32] ───(ESP-NOW)──┘                                                      ├── SQLite (node:sqlite)
   (RC522 Master + SG90 + HC-SR04 + OLED/LED)                                            ├── Aedes MQTT Broker
                                                                                         └── Express REST + WebSocket
                                                                                                    ▲
                                                                                                    │ (HTTP + WS :3000)
                                                                                         [Mobile App Expo Go]
                                                                                         (User & Operator Roles)
```

### Quy ước nghiệp vụ chính

- **Kiểm soát chỗ trống & đèn LED (1 LED mỗi ô đỗ)**:
  - `FREE` (Trống) / `OCCUPIED` (Đang đỗ hợp lệ): **LED Tắt** (bình thường, không sao)
  - `RESERVED` (Đã đặt lịch giữ chỗ): **LED Sáng cố định**
  - `OVERTIME` (Quá giờ phạt) / Đỗ nhầm vào ô đặt trước / `MAINTENANCE` (Bảo trì): **LED Nhấp nháy nhanh (250ms)** để báo người kiểm tra
- **Quét QR tại cổng & Thanh toán**:
  - User quét mã QR dán ở cổng trên Mobile App để xác minh UID tài khoản, lưu thời gian vào và mở barrier.
  - Khi ra cổng, quét lại mã QR cổng để tính tiền (theo giờ, phí qua đêm, hoặc phạt quá thời lượng tối đa). Thanh toán bằng Ví nội bộ mô phỏng hoặc QR chuyển khoản giả lập → hệ thống tự động mở barrier cho xe ra.
- **Đặt lịch & Yêu cầu qua đêm**: Đặt lịch giữ chỗ tự động duyệt ngay khi còn chỗ trống. Yêu cầu để xe qua đêm do người dùng gửi ở trạng thái chờ duyệt (`PENDING`) và cần Người điều hành duyệt trên App (phải tạo trước khi quá giờ quy định để tránh bị phạt).
- **RFID Master khẩn cấp**: Quét thẻ RFID Master lên RC522 ở Node Cổng để đóng/mở barrier khẩn cấp offline/online ngay lập tức.
- **Người điều hành (Operator)**: Phân phối/đổi ô đỗ, khóa bảo trì ô, đóng/mở barrier từ xa, hiển thị mã QR cổng, chỉnh bảng giá & thời lượng đỗ tối đa (có preset 2 phút để demo), xử lý phiếu báo cáo lỗi thủ công.

---

## Cấu trúc thư mục

- [docs/WIRING_GUIDE.md](docs/WIRING_GUIDE.md) — Sơ đồ đấu nối chi tiết 2x ESP32 + 2x ESP8266 khớp bảng linh kiện
- `firmware/` — Dự án PlatformIO gồm 2 node ESP32 (`gateway`, `gate`) + 2 node ESP8266 (`floor1`, `floor2`)
- `backend/` — Server TypeScript (`Express`, `ws`, `aedes`, `node:sqlite`)
- `mobile/` — Ứng dụng React Native Expo Go (Camera QR + Realtime WebSocket)

---

## Hướng dẫn cài đặt & chạy nhanh

### 1. Chạy Backend Server (trên laptop cùng mạng Wi-Fi với mạch và điện thoại)

```bash
cd backend
npm install
npm run dev
```

Server khởi động đồng thời:

- HTTP & WebSocket: `http://<LAN_IP>:3000`
- MQTT Broker nhúng (Aedes): `mqtt://<LAN_IP>:1883`

> **Lưu ý Windows Firewall**: Mở cho phép Node.js nhận kết nối Private/Public trên cổng `3000` và `1883` để Gateway và điện thoại truy cập được qua Wi-Fi LAN.

### 2. Nạp Firmware vào 2x ESP32 + 2x ESP8266 (PlatformIO)

1. Mở file `firmware/include/config.h` và điền:
   - `WIFI_SSID`, `WIFI_PASS`
   - `MQTT_HOST` = địa chỉ LAN IP của laptop (in ra ngay khi chạy Backend)
   - `MASTER_RFID_UIDS` = UID thẻ RFID Master (xem trong Serial Monitor khi quẹt thẻ vào Node Cổng)
2. Biên dịch kiểm tra cả 4 board:
   ```bash
   pio run -d firmware
   ```
3. Cắm lần lượt từng board và nạp đúng môi trường (`gateway`, `gate` cho 2 mạch ESP32; `floor1`, `floor2` cho 2 mạch ESP8266):
   ```bash
   pio run -d firmware -e gateway -t upload
   pio run -d firmware -e floor1  -t upload
   pio run -d firmware -e floor2  -t upload
   pio run -d firmware -e gate    -t upload
   ```

   *(Node con tự động quét Wi-Fi để đồng bộ kênh ESP-NOW và tự tìm địa chỉ MAC của Gateway.)*

### 3. Chạy Mobile App (React Native + Expo Go)

```bash
cd mobile
npm install
npx expo start
```

Quét mã QR bằng ứng dụng **Expo Go** trên Android/iOS (cùng mạng Wi-Fi). App tự động nhận IP máy chủ cổng `3000` (hoặc nhấn **"Cấu hình Server URL"** ở màn hình đăng nhập để nhập IP thủ công).

### Tài khoản demo có sẵn

| Vai trò             | Tên đăng nhập | Mật khẩu | Ghi chú                                                               |
| :------------------- | :---------------- | :--------- | :--------------------------------------------------------------------- |
| Người điều hành | `admin`         | `123456` | Phân phối ô, barrier, QR cổng, cài đặt giá/phạt, xử lý lỗi |
| Người dùng 1      | `user1`         | `123456` | `UID-USER01`, biển số `30A-123.45`, ví `500.000đ`            |
| Người dùng 2      | `user2`         | `123456` | `UID-USER02`, biển số `51G-678.90`, ví `500.000đ`            |
