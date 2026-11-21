import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  port: number;
  mqttPort: number;
  jwtSecret: string;
  dbPath: string;
  gateQrSecret: string;
}

export function loadConfig(overrides?: Partial<AppConfig>): AppConfig {
  const defaultDbPath = path.resolve(__dirname, '..', 'data', 'parking.db');
  return {
    port: overrides?.port ?? Number(process.env.PORT || 3000),
    mqttPort: overrides?.mqttPort ?? Number(process.env.MQTT_PORT || 1883),
    jwtSecret: overrides?.jwtSecret ?? (process.env.JWT_SECRET || 'smart-parking-iot-secret-dev'),
    dbPath: overrides?.dbPath ?? (process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : defaultDbPath),
    gateQrSecret: overrides?.gateQrSecret ?? (process.env.GATE_QR_SECRET || 'SMART_PARKING_GATE_MAIN_V1'),
  };
}
