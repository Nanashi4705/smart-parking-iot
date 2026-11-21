# Hướng dẫn Đấu nối Phần cứng (2x ESP32 DevKit + 2x ESP8266 NodeMCU)

Tài liệu này tương thích với cấu hình **2 board ESP32 DevKit 30 chân** (Gateway + Node Cổng) và **2 board ESP8266 NodeMCU** (Node Tầng 1 + Node Tầng 2), dùng **1 đèn LED đơn cho mỗi ô đỗ**, đối chiếu với bảng linh kiện [danh_sach_linh_kien_bai_do_xe.xlsx](../danh_sach_linh_kien_bai_do_xe.xlsx).

> [!CAUTION]
> **CẢNH BÁO AN TOÀN MẠCH:**
> 1. **Module RFID RC522 chỉ chạy 3.3V** — tuyệt đối KHÔNG nối chân `3.3V` của RC522 vào `5V`/`VIN` vì sẽ cháy chip.
> 2. **Chân `ECHO` của cả 5 cảm biến HC-SR04 xuất xung 5V**, còn ESP8266 và ESP32 đều dùng mức logic **3.3V**. Bắt buộc lắp cầu chia áp **1kΩ + 2kΩ** cho cả 5 chân `ECHO`.
> 3. **Servo SG90 dùng nguồn adapter 5V 2–3A riêng** + **tụ hóa 470–1000µF** mắc song song vào cực `+5V` và `GND` của adapter, **KHÔNG lấy nguồn 5V từ chân board**. Nhớ nối **chung `GND`** giữa adapter 5V và ESP32 Node Cổng.
> 4. Trên ESP8266 NodeMCU, **để trống chân `D3 (GPIO0)` và `D4 (GPIO2)`** để mạch khởi động/nạp code luôn ổn định.

---

## 1. Sơ đồ cầu chia áp cho chân ECHO (HC-SR04 → ESP8266 / ESP32)

Lắp giống nhau cho tất cả 5 cảm biến siêu âm (4 ô đỗ + 1 cổng):

```text
HC-SR04 ECHO (5V) ──[ R1 = 1kΩ ]──┬──► Chân ECHO trên ESP
                                   │
                              [ R2 = 2kΩ ]
                                   │
                                  GND
```

*(Công thức: $V_{out} = 5V \times \frac{2k\Omega}{1k\Omega + 2k\Omega} \approx 3.33V$.)*

---

## 2. Node 0: Gateway — ESP32 DevKit (`env: gateway`)

- **Không cần nối linh kiện ngoài**.
- Chỉ cấp nguồn qua cáp Micro-USB / Type-C nối vào máy tính hoặc củ sạc 5V.
- Kết nối Wi-Fi cục bộ tới MQTT Broker trên laptop và giao tiếp **ESP-NOW** với 2 node tầng ESP8266 + node cổng ESP32.

---

## 3. Node Tầng 1 & Node Tầng 2 — ESP8266 NodeMCU (`env: floor1`, `env: floor2`)

Hai node tầng đấu nối chân **giống hệt nhau**, chỉ khác cờ build `-DFLOOR_ID=1` và `-DFLOOR_ID=2` trong [platformio.ini](../firmware/platformio.ini). Mỗi ô đỗ chỉ dùng **1 đèn LED duy nhất** (khuyên dùng LED đỏ 5mm).

| Thiết bị | Chân linh kiện | Chân NodeMCU | GPIO | Ghi chú điện trở / cách đấu |
| :--- | :--- | :--- | :--- | :--- |
| **HC-SR04 Ô 1** (`F1-S1` / `F2-S1`) | `VCC` | `VIN` (`VU`, 5V USB) | — | HC-SR04 cần nguồn 5V |
| | `GND` | `GND` | — | |
| | `TRIG` | **`D5`** | GPIO14 | Nối trực tiếp |
| | `ECHO` | **`D1`** | GPIO5 | **Qua cầu chia áp 1kΩ + 2kΩ** |
| **LED Ô 1** | Anode (`+`, chân dài) | **`D7`** | GPIO13 | Qua **220Ω**; Cathode (`-`) nối `GND` |
| **HC-SR04 Ô 2** (`F1-S2` / `F2-S2`) | `VCC` | `VIN` (`VU`, 5V USB) | — | |
| | `GND` | `GND` | — | |
| | `TRIG` | **`D6`** | GPIO12 | Nối trực tiếp |
| | `ECHO` | **`D2`** | GPIO4 | **Qua cầu chia áp 1kΩ + 2kΩ** |
| **LED Ô 2** | Anode (`+`, chân dài) | **`D8`** | GPIO15 | Qua **220Ω**; Cathode (`-`) nối `GND` |

> **Mẹo kiểm tra chân `VIN` / `VU` trên NodeMCU:** Một số mạch NodeMCU V3 ghi chân 5V USB là `VU` hoặc `VV` (thay cho `VIN`). Đo bằng đồng hồ VOM chân có 5V khi cắm USB để cấp cho `VCC` của HC-SR04.

### Quy ước 1 đèn LED hiển thị tại mỗi ô đỗ

| Trạng thái ô đỗ | Đèn LED (1 LED/ô) | Ý nghĩa |
| :--- | :--- | :--- |
| `FREE` (Trống) / `OCCUPIED` (Đỗ hợp lệ) | **Tắt** | Bình thường / không sao |
| `RESERVED` (Đã đặt lịch, chưa có xe) | **Sáng cố định** | Ô đã được đặt trước trên App |
| `OVERTIME` (Quá giờ) / Đỗ nhầm ô đặt trước / `MAINTENANCE` (Bảo trì) | **Nhấp nháy nhanh (250ms)** | Sai quy định hoặc có sự cố, báo người kiểm tra |

---

## 4. Node Cổng — ESP32 DevKit 30 chân (`env: gate`)

| Thiết bị | Chân linh kiện | Chân ESP32 / Nguồn | Ghi chú |
| :--- | :--- | :--- | :--- |
| **RFID RC522** | `3.3V` | **`3V3`** | **TUYỆT ĐỐI KHÔNG CẮM 5V** |
| | `RST` | `GPIO 4` | |
| | `GND` | `GND` | |
| | `MISO` | `GPIO 19` | SPI MISO |
| | `MOSI` | `GPIO 23` | SPI MOSI |
| | `SCK` | `GPIO 18` | SPI SCK |
| | `SDA` (SS) | `GPIO 5` | SPI Chip Select |
| **Servo SG90** | Cam (Signal) | `GPIO 13` | PWM điều khiển góc 0° / 90° |
| | Đỏ (`VCC`) | **`+5V` Adapter riêng** | Nối tụ 470–1000µF giữa `+5V` và `GND` (chân âm `-` tụ về `GND`) |
| | Nâu (`GND`) | `GND` Adapter + `GND` ESP32 | **Bắt buộc nối chung mass (GND)** |
| **HC-SR04 Cổng** | `VCC` | `VIN` (5V) | Phát hiện xe đi qua để tự đóng & chống kẹt |
| | `GND` | `GND` | |
| | `TRIG` | `GPIO 14` | |
| | `ECHO` | `GPIO 34` | **Qua cầu chia áp 1kΩ + 2kΩ** |
| **LED Xanh Cổng** *(tùy chọn)* | Anode (`+`) | `GPIO 25` | Qua 220Ω, Cathode về `GND`. Tắt qua `ENABLE_GATE_LEDS 0` nếu chưa lắp |
| **LED Đỏ Cổng** *(tùy chọn)* | Anode (`+`) | `GPIO 26` | Qua 220Ω, Cathode về `GND` |
| **OLED 0.96" I2C** *(tùy chọn)* | `VCC` | `3V3` | Địa chỉ mặc định `0x3C`. Tắt qua `ENABLE_GATE_OLED 0` nếu chưa lắp |
| | `GND` | `GND` | |
| | `SDA` | `GPIO 21` | |
| | `SCL` | `GPIO 22` | |

---

## 5. Cách lấy UID thẻ RFID Master thật

1. Nạp firmware môi trường `gate` vào ESP32 Node Cổng và mở **Serial Monitor** ở baudrate `115200`.
2. Đưa lần lượt các thẻ/móc khóa RFID vào sát module RC522.
3. Serial sẽ in ra dòng ví dụ: `[RFID] Quet the UID: "A3 B1 4C 29"`.
4. Copy chuỗi UID này điền vào mảng `MASTER_RFID_UIDS[]` trong [config.h](../firmware/include/config.h) rồi nạp lại cho Node Cổng.
5. Khi quẹt thẻ Master: barrier sẽ lập tức **mở khẩn cấp** (hoặc **đóng lại**) kể cả khi Gateway/Wi-Fi bị ngắt, và tự gửi log lên hệ thống khi có kết nối.
