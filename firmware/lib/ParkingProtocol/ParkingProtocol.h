#pragma once

#include <Arduino.h>
#include <cstring>

#ifdef ESP8266
  #include <ESP8266WiFi.h>
  extern "C" {
    #include <espnow.h>
    #include <user_interface.h>
  }
#else
  #include <WiFi.h>
  #include <esp_now.h>
  #include <esp_wifi.h>
#endif

static const uint8_t PROTOCOL_MAGIC = 0x50; // 'P'
static const uint8_t PROTOCOL_VERSION = 1;

enum NodeId : uint8_t {
  NODE_GATEWAY = 0,
  NODE_FLOOR_1 = 1,
  NODE_FLOOR_2 = 2,
  NODE_GATE = 3
};

enum PacketType : uint8_t {
  PKT_NODE_HELLO = 1,
  PKT_GATEWAY_ACK = 2,
  PKT_FLOOR_TELEMETRY = 3,
  PKT_SLOT_LED_CMD = 4,
  PKT_GATE_EVENT = 5,
  PKT_BARRIER_CMD = 6,
  PKT_OLED_STATUS = 7
};

// Quy uoc 1 LED moi o do (khop 100% voi Backend):
// 0 = LED_OFF   -> Khong sao / Binh thuong (Trong hoac Dang do hop le)
// 1 = LED_ON    -> Da dat lich truoc (RESERVED, chua co xe do vao)
// 2 = LED_BLINK -> Sai / Can kiem tra (Qua gio OVERTIME, do nham o dat truoc, hoac Bao tri)
enum SlotLedMode : uint8_t {
  LED_OFF = 0,
  LED_ON = 1,
  LED_BLINK = 2
};

// Ma chi tiet hien thi tren man hinh OLED o Node Cong
enum OledSlotCode : uint8_t {
  OLED_FREE = 0,
  OLED_RESERVED = 1,
  OLED_OCCUPIED = 2,
  OLED_OVERTIME = 3,
  OLED_MAINTENANCE = 4
};

enum BarrierAction : uint8_t {
  BARRIER_CLOSE = 0,
  BARRIER_OPEN_AUTO = 1,
  BARRIER_OPEN_HOLD = 2
};

enum GateEventType : uint8_t {
  GEVT_RFID_EMERGENCY_OPEN = 1,
  GEVT_RFID_EMERGENCY_CLOSE = 2,
  GEVT_RFID_DENIED = 3,
  GEVT_BARRIER_OPENED = 4,
  GEVT_BARRIER_CLOSED = 5,
  GEVT_CAR_PASSED = 6,
  GEVT_BARRIER_BLOCKED = 7
};

struct __attribute__((packed)) PacketHeader {
  uint8_t magic;
  uint8_t version;
  uint8_t type;
  uint8_t nodeId;
};

struct __attribute__((packed)) NodeHelloPacket {
  PacketHeader header;
  uint32_t uptimeMs;
};

struct __attribute__((packed)) GatewayAckPacket {
  PacketHeader header;
  uint8_t wifiChannel;
  uint8_t gatewayOnline;
};

struct __attribute__((packed)) FloorTelemetryPacket {
  PacketHeader header;
  uint8_t floorId;
  uint8_t occupied[2];
  uint16_t distanceCm[2];
  uint32_t seq;
};

struct __attribute__((packed)) SlotLedCmdPacket {
  PacketHeader header;
  uint8_t floorId;
  uint8_t ledMode[2];
  uint32_t seq;
};

struct __attribute__((packed)) GateEventPacket {
  PacketHeader header;
  uint8_t eventType;
  uint8_t barrierOpen;
  uint8_t carAtGate;
  uint16_t gateDistanceCm;
  char rfidUid[24];
  uint32_t seq;
};

struct __attribute__((packed)) BarrierCmdPacket {
  PacketHeader header;
  uint8_t action;
  char reason[32];
  char displayLine[22];
  uint32_t seq;
};

struct __attribute__((packed)) OledStatusPacket {
  PacketHeader header;
  uint8_t freeCount;
  uint8_t totalCount;
  uint8_t slotModes[4];
  char statusText[22];
};

inline bool isBroadcastMac(const uint8_t* mac) {
  for (int i = 0; i < 6; i++) {
    if (mac[i] != 0xFF) return false;
  }
  return true;
}

inline bool ensureEspNowPeer(const uint8_t* mac, uint8_t channel = 0, bool forceRefresh = false) {
#ifdef ESP8266
  uint8_t addr[6];
  memcpy(addr, mac, 6);
  if (esp_now_is_peer_exist(addr) > 0) {
    if (!forceRefresh) return true;
    esp_now_del_peer(addr);
  }
  return esp_now_add_peer(addr, ESP_NOW_ROLE_COMBO, channel, NULL, 0) == 0;
#else
  if (esp_now_is_peer_exist(mac)) {
    if (!forceRefresh) return true;
    esp_now_del_peer(mac);
  }
  esp_now_peer_info_t peerInfo = {};
  memcpy(peerInfo.peer_addr, mac, 6);
  peerInfo.channel = channel;
  peerInfo.encrypt = false;
  return esp_now_add_peer(&peerInfo) == ESP_OK;
#endif
}

inline int sendEspNowPacket(const uint8_t* mac, const uint8_t* data, size_t len) {
#ifdef ESP8266
  uint8_t addr[6];
  memcpy(addr, mac, 6);
  return esp_now_send(addr, const_cast<uint8_t*>(data), static_cast<int>(len));
#else
  return esp_now_send(mac, data, len) == ESP_OK ? 0 : -1;
#endif
}

inline uint8_t syncWifiChannelBySsid(const char* targetSsid) {
#ifdef ESP8266
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  WiFi.disconnect();
  delay(100);

  int n = WiFi.scanNetworks(false, true);
  uint8_t foundChannel = 0;
  for (int i = 0; i < n; i++) {
    if (WiFi.SSID(i) == String(targetSsid)) {
      foundChannel = static_cast<uint8_t>(WiFi.channel(i));
      break;
    }
  }
  WiFi.scanDelete();

  if (foundChannel >= 1 && foundChannel <= 13) {
    wifi_promiscuous_enable(1);
    wifi_set_channel(foundChannel);
    wifi_promiscuous_enable(0);
  }
  return foundChannel;
#else
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(false, true);
  delay(100);

  int n = WiFi.scanNetworks(false, true);
  uint8_t foundChannel = 0;
  for (int i = 0; i < n; i++) {
    if (WiFi.SSID(i) == String(targetSsid)) {
      foundChannel = static_cast<uint8_t>(WiFi.channel(i));
      break;
    }
  }
  WiFi.scanDelete();

  if (foundChannel >= 1 && foundChannel <= 13) {
    esp_wifi_set_promiscuous(true);
    esp_wifi_set_channel(foundChannel, WIFI_SECOND_CHAN_NONE);
    esp_wifi_set_promiscuous(false);
  }
  return foundChannel;
#endif
}

inline const char* gateEventToString(uint8_t eventType) {
  switch (eventType) {
    case GEVT_RFID_EMERGENCY_OPEN: return "RFID_EMERGENCY_OPEN";
    case GEVT_RFID_EMERGENCY_CLOSE: return "RFID_EMERGENCY_CLOSE";
    case GEVT_RFID_DENIED: return "RFID_DENIED";
    case GEVT_BARRIER_OPENED: return "BARRIER_OPENED";
    case GEVT_BARRIER_CLOSED: return "BARRIER_CLOSED";
    case GEVT_CAR_PASSED: return "CAR_PASSED";
    case GEVT_BARRIER_BLOCKED: return "BARRIER_BLOCKED";
    default: return "UNKNOWN";
  }
}
