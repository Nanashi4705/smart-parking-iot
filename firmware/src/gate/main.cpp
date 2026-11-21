#include <Arduino.h>
#include <WiFi.h>
#include <SPI.h>
#include <Wire.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <MFRC522.h>
#include <ESP32Servo.h>
#include "config.h"
#include "ParkingProtocol.h"

#if ENABLE_GATE_OLED
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#endif

// =============================================================================
// NODE CONG: RC522 RFID (Master khan cap) + Servo SG90 + HC-SR04 + LED + OLED
// =============================================================================

static const uint8_t PIN_RFID_SS   = 5;
static const uint8_t PIN_RFID_RST  = 4;
static const uint8_t PIN_SERVO     = 13;
static const uint8_t PIN_GATE_TRIG = 14;
static const uint8_t PIN_GATE_ECHO = 34;
static const uint8_t PIN_LED_GREEN = 25;
static const uint8_t PIN_LED_RED   = 26;

static MFRC522 rfid(PIN_RFID_SS, PIN_RFID_RST);
static Servo barrierServo;

#if ENABLE_GATE_OLED
static Adafruit_SSD1306 oled(128, 64, &Wire, -1);
static bool oledReady = false;
#endif

enum BarrierState {
  BSTATE_CLOSED = 0,
  BSTATE_OPEN_AUTO = 1,
  BSTATE_OPEN_HOLD = 2,
  BSTATE_EMERGENCY_OPEN = 3
};

static BarrierState barrierState = BSTATE_CLOSED;
static unsigned long barrierOpenedAtMs = 0;
static bool carSeenUnderGate = false;
static unsigned long carClearedAtMs = 0;
static bool carAtGate = false;
static uint16_t gateDistanceCm = 999;

static uint8_t gatewayMac[6] = GATEWAY_MAC_OVERRIDE;
static bool gatewayLinked = !isBroadcastMac(gatewayMac);
static uint8_t currentChannel = 1;
static volatile int sendFailCount = 0;
static uint32_t txSeq = 0;

static unsigned long lastGatePollMs = 0;
static unsigned long lastHelloMs = 0;
static unsigned long redAlertUntilMs = 0;
static unsigned long greenPulseUntilMs = 0;
static unsigned long lastRfidScanMs = 0;
static String lastRfidUid = "";

// Trang thai hien thi OLED
static uint8_t dispFreeCount = 4;
static uint8_t dispTotalCount = 4;
static uint8_t dispSlotModes[4] = {0, 0, 0, 0};
static char dispStatusLine[24] = "SAN SANG";
static unsigned long statusOverrideUntilMs = 0;
static bool oledDirty = true;

// Queue nhan lenh tu Gateway
static volatile bool pendingAck = false;
static uint8_t ackChannel = 0;
static uint8_t ackFromMac[6] = {0};
static volatile bool pendingBarrierCmd = false;
static BarrierCmdPacket rxBarrierCmd;
static volatile bool pendingOledCmd = false;
static OledStatusPacket rxOledCmd;
static portMUX_TYPE rxMux = portMUX_INITIALIZER_UNLOCKED;

void onEspNowRecv(const uint8_t* mac, const uint8_t* data, int len) {
  if (len < static_cast<int>(sizeof(PacketHeader))) return;
  const PacketHeader* hdr = reinterpret_cast<const PacketHeader*>(data);
  if (hdr->magic != PROTOCOL_MAGIC || hdr->version != PROTOCOL_VERSION) return;

  portENTER_CRITICAL(&rxMux);
  if (hdr->type == PKT_GATEWAY_ACK && len >= static_cast<int>(sizeof(GatewayAckPacket))) {
    const GatewayAckPacket* ack = reinterpret_cast<const GatewayAckPacket*>(data);
    memcpy(ackFromMac, mac, 6);
    ackChannel = ack->wifiChannel;
    pendingAck = true;
  } else if (hdr->type == PKT_BARRIER_CMD && len >= static_cast<int>(sizeof(BarrierCmdPacket))) {
    rxBarrierCmd = *reinterpret_cast<const BarrierCmdPacket*>(data);
    pendingBarrierCmd = true;
  } else if (hdr->type == PKT_OLED_STATUS && len >= static_cast<int>(sizeof(OledStatusPacket))) {
    rxOledCmd = *reinterpret_cast<const OledStatusPacket*>(data);
    pendingOledCmd = true;
  }
  portEXIT_CRITICAL(&rxMux);
}

void onEspNowSent(const uint8_t* /*mac*/, esp_now_send_status_t status) {
  if (status == ESP_NOW_SEND_SUCCESS) {
    sendFailCount = 0;
  } else {
    sendFailCount++;
  }
}

uint16_t readGateUltrasonicCm() {
  digitalWrite(PIN_GATE_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_GATE_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_GATE_TRIG, LOW);

  unsigned long duration = pulseIn(PIN_GATE_ECHO, HIGH, 25000UL);
  if (duration == 0) return 999;
  uint16_t cm = static_cast<uint16_t>((duration * 343UL) / 20000UL);
  return cm == 0 ? 1 : cm;
}

void sendHello() {
  uint8_t bcast[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
  ensureEspNowPeer(bcast, currentChannel);
  NodeHelloPacket hello = {};
  hello.header.magic = PROTOCOL_MAGIC;
  hello.header.version = PROTOCOL_VERSION;
  hello.header.type = PKT_NODE_HELLO;
  hello.header.nodeId = NODE_GATE;
  hello.uptimeMs = millis();
  esp_now_send(bcast, reinterpret_cast<uint8_t*>(&hello), sizeof(hello));
}

void sendGateEvent(uint8_t eventType, const char* uid = "") {
  if (!gatewayLinked) return;
  ensureEspNowPeer(gatewayMac, currentChannel);

  GateEventPacket pkt = {};
  pkt.header.magic = PROTOCOL_MAGIC;
  pkt.header.version = PROTOCOL_VERSION;
  pkt.header.type = PKT_GATE_EVENT;
  pkt.header.nodeId = NODE_GATE;
  pkt.eventType = eventType;
  pkt.barrierOpen = (barrierState != BSTATE_CLOSED) ? 1 : 0;
  pkt.carAtGate = carAtGate ? 1 : 0;
  pkt.gateDistanceCm = gateDistanceCm;
  if (uid != nullptr) {
    strncpy(pkt.rfidUid, uid, sizeof(pkt.rfidUid) - 1);
  }
  pkt.seq = ++txSeq;

  esp_now_send(gatewayMac, reinterpret_cast<uint8_t*>(&pkt), sizeof(pkt));
}

char slotModeChar(uint8_t code) {
  switch (code) {
    case OLED_FREE: return '_';
    case OLED_RESERVED: return 'R';
    case OLED_OCCUPIED: return 'X';
    case OLED_OVERTIME: return '!';
    case OLED_MAINTENANCE: return 'M';
    default: return '?';
  }
}

void setBannerStatus(const char* text, unsigned long holdMs = 3500) {
  strncpy(dispStatusLine, text, sizeof(dispStatusLine) - 1);
  dispStatusLine[sizeof(dispStatusLine) - 1] = '\0';
  statusOverrideUntilMs = millis() + holdMs;
  oledDirty = true;
}

void renderOled() {
#if ENABLE_GATE_OLED
  if (!oledReady || !oledDirty) return;
  oledDirty = false;

  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.println("SMART PARKING GATE");
  oled.drawLine(0, 10, 127, 10, SSD1306_WHITE);

  oled.setTextSize(2);
  oled.setCursor(0, 16);
  oled.printf("TRONG:%u/%u", dispFreeCount, dispTotalCount);

  oled.setTextSize(1);
  oled.setCursor(0, 38);
  oled.printf("1:%c 2:%c 3:%c 4:%c",
              slotModeChar(dispSlotModes[0]),
              slotModeChar(dispSlotModes[1]),
              slotModeChar(dispSlotModes[2]),
              slotModeChar(dispSlotModes[3]));

  oled.setCursor(0, 52);
  oled.print(dispStatusLine);
  oled.display();
#endif
}

void updateGateLeds() {
#if ENABLE_GATE_LEDS
  unsigned long now = millis();
  if (now < redAlertUntilMs) {
    digitalWrite(PIN_LED_GREEN, LOW);
    digitalWrite(PIN_LED_RED, HIGH);
  } else if (barrierState != BSTATE_CLOSED || now < greenPulseUntilMs) {
    digitalWrite(PIN_LED_GREEN, HIGH);
    digitalWrite(PIN_LED_RED, LOW);
  } else {
    digitalWrite(PIN_LED_GREEN, LOW);
    digitalWrite(PIN_LED_RED, LOW);
  }
#endif
}

void openBarrier(BarrierState newState, const char* banner) {
  barrierState = newState;
  barrierOpenedAtMs = millis();
  carSeenUnderGate = false;
  carClearedAtMs = 0;
  barrierServo.write(SERVO_OPEN_ANGLE);
  greenPulseUntilMs = millis() + 2000;
  setBannerStatus(banner, 4000);
  Serial.printf("[GATE] MO BARRIER (state=%d): %s\n", static_cast<int>(newState), banner);
}

bool closeBarrier(bool force = false) {
  if (!force && carAtGate) {
    redAlertUntilMs = millis() + 2000;
    setBannerStatus("CO XE DUOI CONG!", 2500);
    sendGateEvent(GEVT_BARRIER_BLOCKED);
    Serial.println("[GATE] Hoan dong barrier vi phat hien xe duoi cong!");
    return false;
  }
  barrierState = BSTATE_CLOSED;
  carSeenUnderGate = false;
  carClearedAtMs = 0;
  barrierServo.write(SERVO_CLOSED_ANGLE);
  setBannerStatus("CONG DA DONG", 2500);
  Serial.println("[GATE] DONG BARRIER");
  return true;
}

bool isMasterRfid(const String& uid) {
  for (int i = 0; i < MASTER_RFID_COUNT; i++) {
    if (uid.equalsIgnoreCase(MASTER_RFID_UIDS[i])) {
      return true;
    }
  }
  return false;
}

void pollRfid() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) {
    return;
  }

  String uidStr = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (i > 0) uidStr += " ";
    if (rfid.uid.uidByte[i] < 0x10) uidStr += "0";
    uidStr += String(rfid.uid.uidByte[i], HEX);
  }
  uidStr.toUpperCase();

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  unsigned long now = millis();
  if (uidStr == lastRfidUid && (now - lastRfidScanMs) < 2000) {
    return;
  }
  lastRfidUid = uidStr;
  lastRfidScanMs = now;

  Serial.printf("[RFID] Quet the UID: \"%s\"\n", uidStr.c_str());

  if (isMasterRfid(uidStr)) {
    if (barrierState == BSTATE_CLOSED) {
      openBarrier(BSTATE_EMERGENCY_OPEN, "RFID KHAN CAP: MO");
      sendGateEvent(GEVT_RFID_EMERGENCY_OPEN, uidStr.c_str());
    } else {
      closeBarrier(true);
      setBannerStatus("RFID KHAN CAP: DONG", 3000);
      sendGateEvent(GEVT_RFID_EMERGENCY_CLOSE, uidStr.c_str());
    }
  } else {
    redAlertUntilMs = now + 1500;
    setBannerStatus("THE RFID LA!", 2500);
    sendGateEvent(GEVT_RFID_DENIED, uidStr.c_str());
  }
}

void initRadioAndSyncChannel() {
  uint8_t ch = syncWifiChannelBySsid(WIFI_SSID);
  if (ch > 0) {
    currentChannel = ch;
    Serial.printf("[WIFI] Dong bo kenh %u theo SSID %s\n", currentChannel, WIFI_SSID);
  }

  esp_now_deinit();
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] Loi khoi tao, thu lai...");
    delay(1500);
    ESP.restart();
  }
  esp_now_register_recv_cb(onEspNowRecv);
  esp_now_register_send_cb(onEspNowSent);

  uint8_t bcast[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
  ensureEspNowPeer(bcast, currentChannel);
  if (gatewayLinked) {
    ensureEspNowPeer(gatewayMac, currentChannel);
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n=== SMART PARKING - NODE CONG (MAC %s) ===\n", WiFi.macAddress().c_str());

  pinMode(PIN_GATE_TRIG, OUTPUT);
  digitalWrite(PIN_GATE_TRIG, LOW);
  pinMode(PIN_GATE_ECHO, INPUT);

#if ENABLE_GATE_LEDS
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED, LOW);
#endif

  barrierServo.setPeriodHertz(50);
  barrierServo.attach(PIN_SERVO, 500, 2400);
  barrierServo.write(SERVO_CLOSED_ANGLE);

  SPI.begin();
  rfid.PCD_Init();
  Serial.println("[RFID] RC522 san sang (quet the Master de xem UID tren Serial)");

#if ENABLE_GATE_OLED
  Wire.begin(21, 22);
  if (oled.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDR)) {
    oledReady = true;
    renderOled();
  } else {
    Serial.println("[OLED] Khong phat hien SSD1306 tai 0x3C (bo qua hien thi)");
  }
#endif

  initRadioAndSyncChannel();
  sendHello();
}

void loop() {
  unsigned long now = millis();

  // 1. Luon uu tien quet RFID khẩn cấp truoc (chay ke ca khi mat mang)
  pollRfid();

  // 2. Xu ly goi tin ESP-NOW
  bool gotAck = false;
  uint8_t newMac[6];
  uint8_t newCh = 0;
  bool gotBarrier = false;
  BarrierCmdPacket bCmd;
  bool gotOled = false;
  OledStatusPacket oCmd;

  portENTER_CRITICAL(&rxMux);
  if (pendingAck) {
    gotAck = true;
    memcpy(newMac, ackFromMac, 6);
    newCh = ackChannel;
    pendingAck = false;
  }
  if (pendingBarrierCmd) {
    gotBarrier = true;
    bCmd = rxBarrierCmd;
    pendingBarrierCmd = false;
  }
  if (pendingOledCmd) {
    gotOled = true;
    oCmd = rxOledCmd;
    pendingOledCmd = false;
  }
  portEXIT_CRITICAL(&rxMux);

  if (gotAck) {
    memcpy(gatewayMac, newMac, 6);
    if (newCh >= 1 && newCh <= 13) currentChannel = newCh;
    gatewayLinked = true;
    sendFailCount = 0;
    ensureEspNowPeer(gatewayMac, currentChannel);
    Serial.printf("[GATE] Da ket noi Gateway (CH %u)\n", currentChannel);
  }

  if (gotBarrier) {
    const char* line = strlen(bCmd.displayLine) > 0 ? bCmd.displayLine : "MO CONG";
    if (bCmd.action == BARRIER_OPEN_AUTO) {
      openBarrier(BSTATE_OPEN_AUTO, line);
      sendGateEvent(GEVT_BARRIER_OPENED);
    } else if (bCmd.action == BARRIER_OPEN_HOLD) {
      openBarrier(BSTATE_OPEN_HOLD, line);
      sendGateEvent(GEVT_BARRIER_OPENED);
    } else {
      if (closeBarrier(false)) {
        sendGateEvent(GEVT_BARRIER_CLOSED);
      }
    }
  }

  if (gotOled) {
    dispFreeCount = oCmd.freeCount;
    dispTotalCount = oCmd.totalCount;
    memcpy(dispSlotModes, oCmd.slotModes, 4);
    if (now >= statusOverrideUntilMs && strlen(oCmd.statusText) > 0) {
      strncpy(dispStatusLine, oCmd.statusText, sizeof(dispStatusLine) - 1);
      dispStatusLine[sizeof(dispStatusLine) - 1] = '\0';
    }
    oledDirty = true;
  }

  // 3. Tu dong quet lai kenh neu mat ket noi Gateway
  if (sendFailCount >= 5) {
    sendFailCount = 0;
    gatewayLinked = !isBroadcastMac(gatewayMac);
    initRadioAndSyncChannel();
    sendHello();
  }
  if (!gatewayLinked && now - lastHelloMs >= 2500) {
    lastHelloMs = now;
    sendHello();
  }

  // 4. Doc cam bien sieu am tai cong moi 150ms & dieu khien dong tu dong
  if (now - lastGatePollMs >= 150) {
    lastGatePollMs = now;
    gateDistanceCm = readGateUltrasonicCm();
    if (!carAtGate && gateDistanceCm <= GATE_CAR_CM) {
      carAtGate = true;
      carSeenUnderGate = true;
      carClearedAtMs = 0;
    } else if (carAtGate && gateDistanceCm >= GATE_CLEAR_CM) {
      carAtGate = false;
      carClearedAtMs = now;
    }

    if (barrierState == BSTATE_OPEN_AUTO) {
      if (carSeenUnderGate && !carAtGate && carClearedAtMs > 0 &&
          (now - carClearedAtMs >= GATE_AUTO_CLOSE_AFTER_PASS_MS)) {
        if (closeBarrier(false)) {
          sendGateEvent(GEVT_CAR_PASSED);
          sendGateEvent(GEVT_BARRIER_CLOSED);
        }
      } else if (!carAtGate && (now - barrierOpenedAtMs >= GATE_AUTO_TIMEOUT_MS)) {
        if (closeBarrier(false)) {
          sendGateEvent(GEVT_BARRIER_CLOSED);
        }
      }
    }
  }

  updateGateLeds();
  renderOled();
}
