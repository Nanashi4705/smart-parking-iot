#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include "config.h"
#include "ParkingProtocol.h"

// =============================================================================
// NODE 0: GATEWAY ESP32 DevKit
// Cau noi giua 3 node con (ESP-NOW) va Backend MQTT Broker (Wi-Fi LAN)
// =============================================================================

static WiFiClient wifiClient;
static PubSubClient mqtt(wifiClient);

static uint8_t nodeMacs[4][6];
static bool nodeKnown[4] = {false, false, false, false};

// Luu lenh moi nhat de tu dong dong bo lai khi Node con khoi dong lai
static SlotLedCmdPacket lastFloorCmd[3];
static bool hasFloorCmd[3] = {false, false, false};
static OledStatusPacket lastOledCmd;
static bool hasOledCmd = false;

// Ring buffer an toan giua callback ESP-NOW va loop()
struct RxFrame {
  uint8_t mac[6];
  int len;
  uint8_t data[128];
};

static const int RX_QUEUE_SIZE = 16;
static RxFrame rxQueue[RX_QUEUE_SIZE];
static volatile int rxHead = 0;
static volatile int rxTail = 0;
static portMUX_TYPE rxMux = portMUX_INITIALIZER_UNLOCKED;

static unsigned long lastHeartbeatMs = 0;
static unsigned long lastMqttReconnectMs = 0;
static uint32_t txSeq = 0;

void onEspNowRecv(const uint8_t* mac, const uint8_t* data, int len) {
  if (len <= 0 || len > 128) return;
  portENTER_CRITICAL(&rxMux);
  int nextHead = (rxHead + 1) % RX_QUEUE_SIZE;
  if (nextHead != rxTail) {
    memcpy(rxQueue[rxHead].mac, mac, 6);
    rxQueue[rxHead].len = len;
    memcpy(rxQueue[rxHead].data, data, len);
    rxHead = nextHead;
  }
  portEXIT_CRITICAL(&rxMux);
}

void onEspNowSent(const uint8_t* mac, esp_now_send_status_t status) {
  if (status != ESP_NOW_SEND_SUCCESS) {
    Serial.printf("[ESP-NOW] Gui toi %02X:%02X:%02X:%02X:%02X:%02X that bai\n",
                  mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  }
}

void sendGatewayAck(const uint8_t* targetMac) {
  uint8_t ch = static_cast<uint8_t>(WiFi.channel());
  ensureEspNowPeer(targetMac, ch, false);

  GatewayAckPacket ack = {};
  ack.header.magic = PROTOCOL_MAGIC;
  ack.header.version = PROTOCOL_VERSION;
  ack.header.type = PKT_GATEWAY_ACK;
  ack.header.nodeId = NODE_GATEWAY;
  ack.wifiChannel = ch;
  ack.gatewayOnline = mqtt.connected() ? 1 : 0;
  sendEspNowPacket(targetMac, reinterpret_cast<uint8_t*>(&ack), sizeof(ack));
}

void sendPacketToNode(uint8_t nodeId, const uint8_t* payload, size_t len) {
  if (nodeId >= 4) return;
  uint8_t ch = static_cast<uint8_t>(WiFi.channel());
  if (nodeKnown[nodeId]) {
    ensureEspNowPeer(nodeMacs[nodeId], ch, false);
    sendEspNowPacket(nodeMacs[nodeId], payload, len);
  } else {
    uint8_t bcast[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
    ensureEspNowPeer(bcast, ch, false);
    sendEspNowPacket(bcast, payload, len);
  }
}

void registerNodeMac(uint8_t nodeId, const uint8_t* mac) {
  if (nodeId < 1 || nodeId > 3) return;
  bool changed = !nodeKnown[nodeId] || memcmp(nodeMacs[nodeId], mac, 6) != 0;
  memcpy(nodeMacs[nodeId], mac, 6);
  nodeKnown[nodeId] = true;
  ensureEspNowPeer(mac, static_cast<uint8_t>(WiFi.channel()), changed);
  if (changed) {
    Serial.printf("[GATEWAY] Ghi nhan Node %u MAC %02X:%02X:%02X:%02X:%02X:%02X\n",
                  nodeId, mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  }
}

void publishGatewayStatus() {
  if (!mqtt.connected()) return;
  JsonDocument doc;
  doc["online"] = true;
  doc["ip"] = WiFi.localIP().toString();
  doc["channel"] = WiFi.channel();
  doc["mac"] = WiFi.macAddress();

  char out[192];
  serializeJson(doc, out, sizeof(out));
  mqtt.publish("parking/gateway/status", out);
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[MQTT] Loi JSON o topic %s: %s\n", topic, err.c_str());
    return;
  }

  String t(topic);
  if (t == "parking/floor/1/cmd" || t == "parking/floor/2/cmd") {
    uint8_t floorId = (t == "parking/floor/1/cmd") ? 1 : 2;
    uint8_t targetNode = (floorId == 1) ? NODE_FLOOR_1 : NODE_FLOOR_2;

    SlotLedCmdPacket cmd = {};
    cmd.header.magic = PROTOCOL_MAGIC;
    cmd.header.version = PROTOCOL_VERSION;
    cmd.header.type = PKT_SLOT_LED_CMD;
    cmd.header.nodeId = NODE_GATEWAY;
    cmd.floorId = floorId;
    cmd.seq = ++txSeq;

    JsonArray slots = doc["slots"].as<JsonArray>();
    for (JsonObject s : slots) {
      int idx = s["index"] | -1;
      int mode = s["ledMode"] | 0;
      if (idx == 0 || idx == 1) {
        cmd.ledMode[idx] = static_cast<uint8_t>(mode);
      }
    }

    lastFloorCmd[floorId] = cmd;
    hasFloorCmd[floorId] = true;
    sendPacketToNode(targetNode, reinterpret_cast<uint8_t*>(&cmd), sizeof(cmd));
  } else if (t == "parking/gate/cmd") {
    BarrierCmdPacket cmd = {};
    cmd.header.magic = PROTOCOL_MAGIC;
    cmd.header.version = PROTOCOL_VERSION;
    cmd.header.type = PKT_BARRIER_CMD;
    cmd.header.nodeId = NODE_GATEWAY;
    cmd.seq = ++txSeq;

    const char* action = doc["action"] | "CLOSE";
    if (strcmp(action, "OPEN_AUTO") == 0) {
      cmd.action = BARRIER_OPEN_AUTO;
    } else if (strcmp(action, "OPEN_HOLD") == 0) {
      cmd.action = BARRIER_OPEN_HOLD;
    } else {
      cmd.action = BARRIER_CLOSE;
    }

    const char* reason = doc["reason"] | "";
    const char* displayLine = doc["displayLine"] | "";
    strncpy(cmd.reason, reason, sizeof(cmd.reason) - 1);
    strncpy(cmd.displayLine, displayLine, sizeof(cmd.displayLine) - 1);

    sendPacketToNode(NODE_GATE, reinterpret_cast<uint8_t*>(&cmd), sizeof(cmd));
  } else if (t == "parking/gate/display") {
    OledStatusPacket pkt = {};
    pkt.header.magic = PROTOCOL_MAGIC;
    pkt.header.version = PROTOCOL_VERSION;
    pkt.header.type = PKT_OLED_STATUS;
    pkt.header.nodeId = NODE_GATEWAY;
    pkt.freeCount = doc["freeCount"] | 0;
    pkt.totalCount = doc["totalCount"] | 4;

    JsonArray modes = doc["slotModes"].as<JsonArray>();
    int i = 0;
    for (JsonVariant v : modes) {
      if (i < 4) {
        pkt.slotModes[i++] = v.as<uint8_t>();
      }
    }
    const char* statusText = doc["statusText"] | "SAN SANG";
    strncpy(pkt.statusText, statusText, sizeof(pkt.statusText) - 1);

    lastOledCmd = pkt;
    hasOledCmd = true;
    sendPacketToNode(NODE_GATE, reinterpret_cast<uint8_t*>(&pkt), sizeof(pkt));
  }
}

void refreshAllPeersChannel() {
  uint8_t ch = static_cast<uint8_t>(WiFi.channel());
  uint8_t bcast[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
  ensureEspNowPeer(bcast, ch, true);
  for (uint8_t i = 1; i <= 3; i++) {
    if (nodeKnown[i]) {
      ensureEspNowPeer(nodeMacs[i], ch, true);
    }
  }
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false); // Giu Wi-Fi + ESP-NOW phan hoi nhanh
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("[WIFI] Dang ket noi toi %s", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.printf("\n[WIFI] Da ket noi! IP=%s | Channel=%d | MAC=%s\n",
                WiFi.localIP().toString().c_str(),
                WiFi.channel(),
                WiFi.macAddress().c_str());
}

void ensureMqttConnected() {
  if (mqtt.connected()) return;
  unsigned long now = millis();
  if (now - lastMqttReconnectMs < 3000) return;
  lastMqttReconnectMs = now;

  Serial.printf("[MQTT] Ket noi toi %s:%d...\n", MQTT_HOST, MQTT_PORT);
  if (mqtt.connect("esp32-gateway-main")) {
    Serial.println("[MQTT] Da ket noi Backend Broker!");
    mqtt.subscribe("parking/floor/1/cmd");
    mqtt.subscribe("parking/floor/2/cmd");
    mqtt.subscribe("parking/gate/cmd");
    mqtt.subscribe("parking/gate/display");
    publishGatewayStatus();
  } else {
    Serial.printf("[MQTT] Ket noi that bai, rc=%d\n", mqtt.state());
  }
}

void processRxFrame(const RxFrame& frame) {
  if (frame.len < static_cast<int>(sizeof(PacketHeader))) return;
  const PacketHeader* hdr = reinterpret_cast<const PacketHeader*>(frame.data);
  if (hdr->magic != PROTOCOL_MAGIC || hdr->version != PROTOCOL_VERSION) return;

  if (hdr->type == PKT_NODE_HELLO && frame.len >= static_cast<int>(sizeof(NodeHelloPacket))) {
    registerNodeMac(hdr->nodeId, frame.mac);
    sendGatewayAck(frame.mac);

    // Dong bo ngay trang thai moi nhat cho node vua online
    if (hdr->nodeId == NODE_FLOOR_1 && hasFloorCmd[1]) {
      sendPacketToNode(NODE_FLOOR_1, reinterpret_cast<uint8_t*>(&lastFloorCmd[1]), sizeof(SlotLedCmdPacket));
    } else if (hdr->nodeId == NODE_FLOOR_2 && hasFloorCmd[2]) {
      sendPacketToNode(NODE_FLOOR_2, reinterpret_cast<uint8_t*>(&lastFloorCmd[2]), sizeof(SlotLedCmdPacket));
    } else if (hdr->nodeId == NODE_GATE && hasOledCmd) {
      sendPacketToNode(NODE_GATE, reinterpret_cast<uint8_t*>(&lastOledCmd), sizeof(OledStatusPacket));
    }
    return;
  }

  if (hdr->type == PKT_FLOOR_TELEMETRY && frame.len >= static_cast<int>(sizeof(FloorTelemetryPacket))) {
    const FloorTelemetryPacket* pkt = reinterpret_cast<const FloorTelemetryPacket*>(frame.data);
    registerNodeMac(hdr->nodeId, frame.mac);

    if (mqtt.connected()) {
      JsonDocument doc;
      doc["floor"] = pkt->floorId;
      JsonArray slots = doc["slots"].to<JsonArray>();
      for (int i = 0; i < 2; i++) {
        JsonObject s = slots.add<JsonObject>();
        s["index"] = i;
        s["occupied"] = pkt->occupied[i] != 0;
        s["distanceCm"] = pkt->distanceCm[i];
      }
      char out[256];
      serializeJson(doc, out, sizeof(out));
      String topic = String("parking/floor/") + String(pkt->floorId) + "/telemetry";
      mqtt.publish(topic.c_str(), out);
    }
    return;
  }

  if (hdr->type == PKT_GATE_EVENT && frame.len >= static_cast<int>(sizeof(GateEventPacket))) {
    const GateEventPacket* pkt = reinterpret_cast<const GateEventPacket*>(frame.data);
    registerNodeMac(hdr->nodeId, frame.mac);

    if (mqtt.connected()) {
      JsonDocument doc;
      doc["eventType"] = gateEventToString(pkt->eventType);
      doc["barrierOpen"] = pkt->barrierOpen != 0;
      doc["carAtGate"] = pkt->carAtGate != 0;
      doc["gateDistanceCm"] = pkt->gateDistanceCm;
      doc["rfidUid"] = pkt->rfidUid;

      char out[256];
      serializeJson(doc, out, sizeof(out));
      mqtt.publish("parking/gate/event", out);
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== SMART PARKING - GATEWAY ESP32 ===");

  connectWifi();

  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] Khoi tao that bai, khoi dong lai...");
    delay(2000);
    ESP.restart();
  }
  esp_now_register_recv_cb(onEspNowRecv);
  esp_now_register_send_cb(onEspNowSent);

  refreshAllPeersChannel();

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(512);
  mqtt.setCallback(onMqttMessage);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
    refreshAllPeersChannel();
  }
  ensureMqttConnected();
  mqtt.loop();

  while (true) {
    RxFrame frame;
    bool hasFrame = false;
    portENTER_CRITICAL(&rxMux);
    if (rxTail != rxHead) {
      frame = rxQueue[rxTail];
      rxTail = (rxTail + 1) % RX_QUEUE_SIZE;
      hasFrame = true;
    }
    portEXIT_CRITICAL(&rxMux);

    if (!hasFrame) break;
    processRxFrame(frame);
  }

  unsigned long now = millis();
  if (now - lastHeartbeatMs >= 15000) {
    lastHeartbeatMs = now;
    publishGatewayStatus();
  }
}
