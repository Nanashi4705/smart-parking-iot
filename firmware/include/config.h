#pragma once

// =============================================================================
// CAU HINH DU AN BAI DO XE THONG MINH (CHINH SUA DUY NHAT FILE NAY TRUOC KHI NAP)
// =============================================================================

// 1. Mang Wi-Fi cuc bo (Gateway ket noi Wi-Fi nay; cac Node con quet SSID nay de dong bo kenh ESP-NOW)
#define WIFI_SSID "UET-Wifi-T1 5Ghz"
#define WIFI_PASS ""

// 2. Dia chi IP may tinh dang chay Backend (aedes MQTT broker port 1883)
#define MQTT_HOST "26.47.85.103"
#define MQTT_PORT 1883

// 3. MAC Gateway (de mac dinh FF:FF:FF:FF:FF:FF de Node con tu dong tim Gateway qua broadcast)
// Neu muon ghim cung MAC Gateway, thay bang MAC in ra tren Serial cua Gateway.
#define GATEWAY_MAC_OVERRIDE {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}

// 4. Danh sach UID the RFID Master mo/dong barrier khan cap (in hoa, cach nhau boi dau cach)
// Khi quet the that len RC522, mo Serial Monitor (115200) de xem UID that roi dien vao day.
static const char* MASTER_RFID_UIDS[] = {
  "DE AD BE EF",
  "12 34 56 78"
};
static const int MASTER_RFID_COUNT = sizeof(MASTER_RFID_UIDS) / sizeof(MASTER_RFID_UIDS[0]);

// 5. Nguong cam bien sieu am HC-SR04 (cm) - co hysteresis tranh nhieu
#define SLOT_OCCUPIED_CM 10   // <= 10cm tinh la co xe
#define SLOT_FREE_CM     14   // >= 14cm tinh la trong
#define GATE_CAR_CM      12   // <= 12cm tinh la co xe tai barrier cong
#define GATE_CLEAR_CM    16   // >= 16cm tinh la xe da di qua khoi barrier

// 6. Goc quay Servo SG90 cho thanh chan barrier
#define SERVO_CLOSED_ANGLE 0
#define SERVO_OPEN_ANGLE   90

// 7. Thoi gian an toan cho cong (ms)
#define GATE_AUTO_CLOSE_AFTER_PASS_MS 1500
#define GATE_AUTO_TIMEOUT_MS          15000

// 8. Co bat/tat linh kien tuy chon o Node Cong (1 = Co lap, 0 = Chua lap)
#define ENABLE_GATE_LEDS 1
#define ENABLE_GATE_OLED 1
#define OLED_I2C_ADDR    0x3C
