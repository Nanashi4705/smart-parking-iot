#include <Arduino.h>
#include <ESP8266WiFi.h>
extern "C" {
  #include <espnow.h>
  #include <user_interface.h>
}
#include "config.h"
#include "ParkingProtocol.h"

// =============================================================================
// NODE TANG 1 & TANG 2 - ESP8266 NodeMCU (Build flag -DFLOOR_ID=1 hoac -DFLOOR_ID=2)
// Moi o do dung 2 cam bien HC-SR04 + 1 LED don:
//   - LED_OFF   (0): Khong sao / Binh thuong (Trong hoac Dang do hop le)
//   - LED_ON    (1): Da dat lich truoc
//   - LED_BLINK (2): Sai / Can kiem tra (Qua gio, do nham o dat truoc, bao tri)
// =============================================================================

#ifndef FLOOR_ID
#define FLOOR_ID 1
#endif

static const uint8_t MY_NODE_ID = (FLOOR_ID == 1) ? NODE_FLOOR_1 : NODE_FLOOR_2;

struct SlotPins {
  uint8_t trigPin;
  uint8_t echoPin;
  uint8_t ledPin;
};

static const SlotPins SLOT_PINS[2] = {
  // O 1: TRIG=D5 (GPIO14), ECHO=D1 (GPIO5, chia ap 5V->3.3V), LED=D7 (GPIO13)
  {D5, D1, D7},
  // O 2: TRIG=D6 (GPIO12), ECHO=D2 (GPIO4, chia ap 5V->3.3V), LED=D8 (GPIO15)
  {D6, D2, D8}
};

static uint8_t gatewayMac[6] = GATEWAY_MAC_OVERRIDE;
static bool gatewayLinked = !isBroadcastMac(gatewayMac);
static uint8_t currentChannel = 1;

static bool slotOccupied[2] = {false, false};
static uint16_t slotDistanceCm[2] = {999, 999};
static uint8_t consecutiveHits[2] = {0, 0};

static uint8_t serverLedMode[2] = {LED_OFF, LED_OFF};
static bool hasServerCmd = false;

static volatile int sendFailCount = 0;
static uint32_t txSeq = 0;

static unsigned long lastSensorPollMs = 0;
static unsigned long lastHeartbeatMs = 0;
static unsigned long lastHelloMs = 0;
static unsigned long lastBlinkFastMs = 0;
static bool blinkFastState = false;

// Queue nhan lenh LED tu ESP-NOW
static volatile bool pendingLedUpdate = false;
static SlotLedCmdPacket pendingLedCmd;
static volatile bool pendingAck = false;
static uint8_t ackChannel = 0;
static uint8_t ackFromMac[6] = {0};

void onEspNowRecv(uint8_t* mac, uint8_t* data, uint8_t len) {
  if (len < sizeof(PacketHeader)) return;
  const PacketHeader* hdr = reinterpret_cast<const PacketHeader*>(data);
  if (hdr->magic != PROTOCOL_MAGIC || hdr->version != PROTOCOL_VERSION) return;

  noInterrupts();
  if (hdr->type == PKT_GATEWAY_ACK && len >= sizeof(GatewayAckPacket)) {
    const GatewayAckPacket* ack = reinterpret_cast<const GatewayAckPacket*>(data);
    memcpy(ackFromMac, mac, 6);
    ackChannel = ack->wifiChannel;
    pendingAck = true;
  } else if (hdr->type == PKT_SLOT_LED_CMD && len >= sizeof(SlotLedCmdPacket)) {
    const SlotLedCmdPacket* cmd = reinterpret_cast<const SlotLedCmdPacket*>(data);
    if (cmd->floorId == FLOOR_ID) {
      pendingLedCmd = *cmd;
      pendingLedUpdate = true;
    }
  }
  interrupts();
}

void onEspNowSent(uint8_t* /*mac*/, uint8_t status) {
  if (status == 0) {
    sendFailCount = 0;
  } else {
    sendFailCount++;
  }
}

uint16_t readSingleUltrasonicCm(uint8_t trigPin, uint8_t echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  unsigned long duration = pulseIn(echoPin, HIGH, 25000UL);
  yield();
  if (duration == 0) {
    return 999; // Qua tam / khong vat can
  }
  uint16_t cm = static_cast<uint16_t>((duration * 343UL) / 20000UL);
  return cm == 0 ? 1 : cm;
}

uint16_t readMedianUltrasonicCm(uint8_t trigPin, uint8_t echoPin) {
  uint16_t a = readSingleUltrasonicCm(trigPin, echoPin);
  delay(3);
  uint16_t b = readSingleUltrasonicCm(trigPin, echoPin);
  delay(3);
  uint16_t c = readSingleUltrasonicCm(trigPin, echoPin);

  if ((a <= b && b <= c) || (c <= b && b <= a)) return b;
  if ((b <= a && a <= c) || (c <= a && a <= b)) return a;
  return c;
}

void applyLedOutput(uint8_t idx, uint8_t mode) {
  const SlotPins& p = SLOT_PINS[idx];
  switch (mode) {
    case LED_ON:
      // Dat truoc = LED sang co dinh
      digitalWrite(p.ledPin, HIGH);
      break;
    case LED_BLINK:
      // Sai / qua gio / bao tri = LED nhap nhay nhanh (250ms)
      digitalWrite(p.ledPin, blinkFastState ? HIGH : LOW);
      break;
    case LED_OFF:
    default:
      // Khong sao / binh thuong = LED tat
      digitalWrite(p.ledPin, LOW);
      break;
  }
}

void sendHello() {
  uint8_t bcast[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
  ensureEspNowPeer(bcast, currentChannel, false);
  NodeHelloPacket hello = {};
  hello.header.magic = PROTOCOL_MAGIC;
  hello.header.version = PROTOCOL_VERSION;
  hello.header.type = PKT_NODE_HELLO;
  hello.header.nodeId = MY_NODE_ID;
  hello.uptimeMs = millis();
  sendEspNowPacket(bcast, reinterpret_cast<uint8_t*>(&hello), sizeof(hello));
}

void sendTelemetry() {
  if (!gatewayLinked) return;
  ensureEspNowPeer(gatewayMac, currentChannel, false);

  FloorTelemetryPacket pkt = {};
  pkt.header.magic = PROTOCOL_MAGIC;
  pkt.header.version = PROTOCOL_VERSION;
  pkt.header.type = PKT_FLOOR_TELEMETRY;
  pkt.header.nodeId = MY_NODE_ID;
  pkt.floorId = FLOOR_ID;
  pkt.occupied[0] = slotOccupied[0] ? 1 : 0;
  pkt.occupied[1] = slotOccupied[1] ? 1 : 0;
  pkt.distanceCm[0] = slotDistanceCm[0];
  pkt.distanceCm[1] = slotDistanceCm[1];
  pkt.seq = ++txSeq;

  sendEspNowPacket(gatewayMac, reinterpret_cast<uint8_t*>(&pkt), sizeof(pkt));
}

void initRadioAndSyncChannel() {
  uint8_t ch = syncWifiChannelBySsid(WIFI_SSID);
  if (ch > 0) {
    currentChannel = ch;
    Serial.printf("[WIFI] Dong bo kenh %u theo SSID %s\n", currentChannel, WIFI_SSID);
  } else {
    Serial.printf("[WIFI] Khong tim thay SSID %s, giu kenh mac dinh %u\n", WIFI_SSID, currentChannel);
  }

  esp_now_deinit();
  if (esp_now_init() != 0) {
    Serial.println("[ESP-NOW] Loi khoi tao, thu lai sau...");
    delay(1500);
    ESP.restart();
  }
  esp_now_set_self_role(ESP_NOW_ROLE_COMBO);
  esp_now_register_recv_cb(onEspNowRecv);
  esp_now_register_send_cb(onEspNowSent);

  uint8_t bcast[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
  ensureEspNowPeer(bcast, currentChannel, true);
  if (gatewayLinked) {
    ensureEspNowPeer(gatewayMac, currentChannel, true);
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n=== SMART PARKING - NODE TANG %d ESP8266 (MAC %s) ===\n",
                FLOOR_ID, WiFi.macAddress().c_str());

  for (int i = 0; i < 2; i++) {
    pinMode(SLOT_PINS[i].trigPin, OUTPUT);
    digitalWrite(SLOT_PINS[i].trigPin, LOW);
    pinMode(SLOT_PINS[i].echoPin, INPUT);
    pinMode(SLOT_PINS[i].ledPin, OUTPUT);
    digitalWrite(SLOT_PINS[i].ledPin, LOW);
  }

  initRadioAndSyncChannel();
  sendHello();
}

void loop() {
  unsigned long now = millis();

  // 1. Xu ly goi tin ESP-NOW nhan duoc
  bool gotAck = false;
  uint8_t newMac[6];
  uint8_t newCh = 0;
  bool gotLed = false;
  SlotLedCmdPacket cmdCopy;

  noInterrupts();
  if (pendingAck) {
    gotAck = true;
    memcpy(newMac, ackFromMac, 6);
    newCh = ackChannel;
    pendingAck = false;
  }
  if (pendingLedUpdate) {
    gotLed = true;
    cmdCopy = pendingLedCmd;
    pendingLedUpdate = false;
  }
  interrupts();

  if (gotAck) {
    memcpy(gatewayMac, newMac, 6);
    if (newCh >= 1 && newCh <= 13) currentChannel = newCh;
    gatewayLinked = true;
    sendFailCount = 0;
    ensureEspNowPeer(gatewayMac, currentChannel, true);
    Serial.printf("[FLOOR %d] Da ket noi Gateway MAC %02X:%02X:%02X:%02X:%02X:%02X (CH %u)\n",
                  FLOOR_ID, gatewayMac[0], gatewayMac[1], gatewayMac[2],
                  gatewayMac[3], gatewayMac[4], gatewayMac[5], currentChannel);
    sendTelemetry();
  }

  if (gotLed) {
    serverLedMode[0] = cmdCopy.ledMode[0];
    serverLedMode[1] = cmdCopy.ledMode[1];
    hasServerCmd = true;
    Serial.printf("[FLOOR %d] Nhan lenh LED: S1=%u, S2=%u\n",
                  FLOOR_ID, serverLedMode[0], serverLedMode[1]);
  }

  // 2. Tu dong quet lai kenh neu mat Gateway
  if (sendFailCount >= 5) {
    Serial.printf("[FLOOR %d] Mat ket noi Gateway, quet lai kenh Wi-Fi...\n", FLOOR_ID);
    sendFailCount = 0;
    gatewayLinked = !isBroadcastMac(gatewayMac);
    initRadioAndSyncChannel();
    sendHello();
  }

  if (!gatewayLinked && now - lastHelloMs >= 2500) {
    lastHelloMs = now;
    sendHello();
  }

  // 3. Doc cam bien sieu am moi 400ms (chong nhieu hysteresis 2 mau lien tiep)
  if (now - lastSensorPollMs >= 400) {
    lastSensorPollMs = now;
    bool stateChanged = false;

    for (int i = 0; i < 2; i++) {
      uint16_t dist = readMedianUltrasonicCm(SLOT_PINS[i].trigPin, SLOT_PINS[i].echoPin);
      slotDistanceCm[i] = dist;

      bool candidate = slotOccupied[i];
      if (!slotOccupied[i] && dist <= SLOT_OCCUPIED_CM) {
        candidate = true;
      } else if (slotOccupied[i] && dist >= SLOT_FREE_CM) {
        candidate = false;
      }

      if (candidate != slotOccupied[i]) {
        consecutiveHits[i]++;
        if (consecutiveHits[i] >= 2) {
          slotOccupied[i] = candidate;
          consecutiveHits[i] = 0;
          stateChanged = true;
          Serial.printf("[FLOOR %d] O %d -> %s (%u cm)\n",
                        FLOOR_ID, i + 1, candidate ? "CO XE" : "TRONG", dist);
        }
      } else {
        consecutiveHits[i] = 0;
      }
    }

    if (stateChanged || (now - lastHeartbeatMs >= 5000)) {
      lastHeartbeatMs = now;
      sendTelemetry();
    }
  }

  // 4. Cap nhat timer nhap nhay LED non-blocking (250ms)
  if (now - lastBlinkFastMs >= 250) {
    lastBlinkFastMs = now;
    blinkFastState = !blinkFastState;
  }

  for (int i = 0; i < 2; i++) {
    uint8_t effectiveMode = hasServerCmd ? serverLedMode[i] : LED_OFF;
    applyLedOutput(i, effectiveMode);
  }

  yield();
}
