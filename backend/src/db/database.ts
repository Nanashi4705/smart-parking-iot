import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { AppConfig } from '../config';
import { ParkingSettings } from '../types/models';

export function initDatabase(config: AppConfig): DatabaseSync {
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('USER', 'OPERATOR')),
      uid TEXT UNIQUE NOT NULL,
      license_plate TEXT NOT NULL DEFAULT '',
      wallet_balance INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY,
      floor INTEGER NOT NULL,
      sensor_index INTEGER NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('FREE', 'RESERVED', 'OCCUPIED', 'OVERTIME', 'MAINTENANCE')),
      sensor_occupied INTEGER NOT NULL DEFAULT 0,
      distance_cm INTEGER NOT NULL DEFAULT 999,
      led_mode INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      slot_id TEXT NOT NULL REFERENCES slots(id),
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'FULFILLED', 'CANCELLED', 'EXPIRED')),
      reserved_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS parking_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      slot_id TEXT REFERENCES slots(id),
      reservation_id INTEGER REFERENCES reservations(id),
      check_in_time TEXT NOT NULL,
      check_out_time TEXT,
      status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'OVERTIME', 'PENDING_PAYMENT', 'COMPLETED')),
      has_overnight_request INTEGER NOT NULL DEFAULT 0,
      base_fee INTEGER NOT NULL DEFAULT 0,
      overnight_fee INTEGER NOT NULL DEFAULT 0,
      penalty_fee INTEGER NOT NULL DEFAULT 0,
      total_fee INTEGER NOT NULL DEFAULT 0,
      paid_at TEXT,
      payment_method TEXT
    );

    CREATE TABLE IF NOT EXISTS overnight_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      session_id INTEGER REFERENCES parking_sessions(id),
      slot_id TEXT REFERENCES slots(id),
      reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED')),
      operator_note TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gate_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_uid TEXT,
      rfid_uid TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fault_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_user_id INTEGER NOT NULL REFERENCES users(id),
      slot_id TEXT REFERENCES slots(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED')),
      operator_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  migrateOvernightRequestsTable(db);
  seedInitialData(db, config);
  return db;
}

function migrateOvernightRequestsTable(db: DatabaseSync): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'overnight_requests'")
    .get() as { sql: string } | undefined;

  if (!row || (row.sql.includes("'PENDING'") && row.sql.includes('operator_note'))) {
    return;
  }

  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.exec(`
      BEGIN;
      CREATE TABLE overnight_requests_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        session_id INTEGER REFERENCES parking_sessions(id),
        slot_id TEXT REFERENCES slots(id),
        reason TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED')),
        operator_note TEXT,
        reviewed_at TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO overnight_requests_new (
        id, user_id, session_id, slot_id, reason, status, operator_note, reviewed_at, created_at
      )
      SELECT id, user_id, session_id, slot_id, reason, status, NULL, NULL, created_at
      FROM overnight_requests;
      DROP TABLE overnight_requests;
      ALTER TABLE overnight_requests_new RENAME TO overnight_requests;
      COMMIT;
    `);
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function seedInitialData(db: DatabaseSync, config: AppConfig): void {
  const now = new Date().toISOString();

  const slotCountRow = db.prepare('SELECT COUNT(*) AS cnt FROM slots').get() as { cnt: number };
  if (slotCountRow.cnt === 0) {
    const insertSlot = db.prepare(`
      INSERT INTO slots (id, floor, sensor_index, label, status, sensor_occupied, distance_cm, led_mode, updated_at)
      VALUES (?, ?, ?, ?, 'FREE', 0, 999, 0, ?)
    `);
    insertSlot.run('F1-S1', 1, 0, 'Tầng 1 - Ô 1', now);
    insertSlot.run('F1-S2', 1, 1, 'Tầng 1 - Ô 2', now);
    insertSlot.run('F2-S1', 2, 0, 'Tầng 2 - Ô 1', now);
    insertSlot.run('F2-S2', 2, 1, 'Tầng 2 - Ô 2', now);
  }

  const userCountRow = db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number };
  if (userCountRow.cnt === 0) {
    const passHash = bcrypt.hashSync('123456', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, uid, license_plate, wallet_balance, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertUser.run('admin', passHash, 'Quản lý bãi xe', 'OPERATOR', 'UID-ADMIN01', '', 0, now);
    insertUser.run('user1', passHash, 'Nguyễn Văn A', 'USER', 'UID-USER01', '30A-123.45', 500000, now);
    insertUser.run('user2', passHash, 'Trần Thị B', 'USER', 'UID-USER02', '51G-678.90', 500000, now);
  }

  const defaultSettings: Record<keyof ParkingSettings, string> = {
    hourly_rate_vnd: '5000',
    overnight_fee_vnd: '30000',
    max_duration_minutes: '240',
    penalty_flat_vnd: '50000',
    penalty_per_hour_vnd: '10000',
    reservation_hold_minutes: '30',
    gate_qr_secret: config.gateQrSecret,
  };

  const upsertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `);
  for (const [key, val] of Object.entries(defaultSettings)) {
    upsertSetting.run(key, val);
  }
}

export function getSettings(db: DatabaseSync): ParkingSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return {
    hourly_rate_vnd: Number(map.hourly_rate_vnd ?? 5000),
    overnight_fee_vnd: Number(map.overnight_fee_vnd ?? 30000),
    max_duration_minutes: Number(map.max_duration_minutes ?? 240),
    penalty_flat_vnd: Number(map.penalty_flat_vnd ?? 50000),
    penalty_per_hour_vnd: Number(map.penalty_per_hour_vnd ?? 10000),
    reservation_hold_minutes: Number(map.reservation_hold_minutes ?? 30),
    gate_qr_secret: map.gate_qr_secret ?? 'SMART_PARKING_GATE_MAIN_V1',
  };
}
