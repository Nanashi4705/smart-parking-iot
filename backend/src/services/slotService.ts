import { DatabaseSync } from 'node:sqlite';
import { LedMode, SlotRow, SlotStatus } from '../types/models';
import { WsHub } from '../ws/hub';

export interface MqttPublisherBridge {
  publishFloorLedCommand(floor: number, ledModes: [LedMode, LedMode]): void;
  publishGateCommand(action: 'CLOSE' | 'OPEN_AUTO' | 'OPEN_HOLD', reason: string, displayLine: string): void;
  publishGateDisplay(freeCount: number, totalCount: number, slotModes: number[], statusText: string): void;
}

export interface EnrichedSlot extends SlotRow {
  reservedByUid: string | null;
  reservedExpiresAt: string | null;
  activeSessionId: number | null;
  activeSessionUid: string | null;
  activeSessionStatus: string | null;
  hasOvernightRequest: boolean;
  wrongOccupancy: boolean;
}

export interface FloorTelemetryItem {
  index: number;
  occupied: boolean;
  distanceCm: number;
}

function statusToOledCode(status: SlotStatus): number {
  switch (status) {
    case 'FREE':
      return 0;
    case 'RESERVED':
      return 1;
    case 'OCCUPIED':
      return 2;
    case 'OVERTIME':
      return 3;
    case 'MAINTENANCE':
      return 4;
  }
}

export class SlotService {
  private bridge: MqttPublisherBridge | null = null;

  constructor(
    private db: DatabaseSync,
    private wsHub: WsHub,
  ) {}

  attachMqttBridge(bridge: MqttPublisherBridge): void {
    this.bridge = bridge;
  }

  getAllSlots(): EnrichedSlot[] {
    const slots = this.db
      .prepare('SELECT * FROM slots ORDER BY floor ASC, sensor_index ASC')
      .all() as unknown as SlotRow[];

    const activeResStmt = this.db.prepare(`
      SELECT r.expires_at, u.uid
      FROM reservations r
      JOIN users u ON u.id = r.user_id
      WHERE r.slot_id = ? AND r.status = 'ACTIVE'
      ORDER BY r.id DESC
      LIMIT 1
    `);

    const activeSesStmt = this.db.prepare(`
      SELECT s.id, s.status, s.has_overnight_request, u.uid
      FROM parking_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.slot_id = ? AND s.status IN ('ACTIVE', 'OVERTIME', 'PENDING_PAYMENT')
      ORDER BY s.id DESC
      LIMIT 1
    `);

    return slots.map((slot) => {
      const res = activeResStmt.get(slot.id) as { expires_at: string; uid: string } | undefined;
      const ses = activeSesStmt.get(slot.id) as
        | { id: number; status: string; has_overnight_request: number; uid: string }
        | undefined;
      const wrongOccupancy =
        slot.sensor_occupied === 1 && (slot.status === 'MAINTENANCE' || Boolean(res));
      return {
        ...slot,
        reservedByUid: res?.uid ?? null,
        reservedExpiresAt: res?.expires_at ?? null,
        activeSessionId: ses?.id ?? null,
        activeSessionUid: ses?.uid ?? null,
        activeSessionStatus: ses?.status ?? null,
        hasOvernightRequest: ses ? ses.has_overnight_request === 1 : false,
        wrongOccupancy,
      };
    });
  }

  getFreeCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM slots WHERE status = 'FREE'")
      .get() as { cnt: number };
    return row.cnt;
  }

  recomputeSlot(slotId: string): SlotRow {
    const slot = this.db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId) as unknown as SlotRow | undefined;
    if (!slot) {
      throw new Error(`Không tìm thấy ô đỗ ${slotId}`);
    }

    let nextStatus: SlotStatus;
    let nextLedMode: LedMode;

    if (slot.status === 'MAINTENANCE') {
      nextStatus = 'MAINTENANCE';
      nextLedMode = 2; // Nhap nhay bao tri / can kiem tra
    } else {
      const overtimeSes = this.db
        .prepare(
          `SELECT id FROM parking_sessions WHERE slot_id = ? AND status = 'OVERTIME' ORDER BY id DESC LIMIT 1`,
        )
        .get(slotId) as { id: number } | undefined;

      if (overtimeSes) {
        nextStatus = 'OVERTIME';
        nextLedMode = 2; // Nhap nhay bao qua gio phat
      } else {
        const activeRes = this.db
          .prepare(`SELECT id FROM reservations WHERE slot_id = ? AND status = 'ACTIVE' ORDER BY id DESC LIMIT 1`)
          .get(slotId) as { id: number } | undefined;

        if (activeRes) {
          nextStatus = 'RESERVED';
          // Co xe do vao o dang dat truoc -> nhap nhay bao nguoi kiem tra; chua co xe -> sang co dinh
          nextLedMode = slot.sensor_occupied === 1 ? 2 : 1;
        } else if (slot.sensor_occupied === 1) {
          nextStatus = 'OCCUPIED';
          nextLedMode = 0; // Do hop le -> tat LED
        } else {
          nextStatus = 'FREE';
          nextLedMode = 0; // Trong -> tat LED
        }
      }
    }

    if (slot.status !== nextStatus || slot.led_mode !== nextLedMode) {
      const now = new Date().toISOString();
      this.db
        .prepare('UPDATE slots SET status = ?, led_mode = ?, updated_at = ? WHERE id = ?')
        .run(nextStatus, nextLedMode, now, slotId);
      return { ...slot, status: nextStatus, led_mode: nextLedMode, updated_at: now };
    }

    return slot;
  }

  recomputeAndSyncAll(): EnrichedSlot[] {
    const rawSlots = this.db
      .prepare('SELECT id FROM slots ORDER BY floor ASC, sensor_index ASC')
      .all() as Array<{ id: string }>;

    for (const row of rawSlots) {
      this.recomputeSlot(row.id);
    }

    const slots = this.getAllSlots();
    this.syncHardware(slots);

    const freeCount = slots.filter((s) => s.status === 'FREE').length;
    this.wsHub.broadcast('SLOTS_UPDATED', {
      slots,
      freeCount,
      totalCount: slots.length,
    });

    return slots;
  }

  syncHardware(slotsArg?: EnrichedSlot[]): void {
    if (!this.bridge) return;
    const slots = slotsArg ?? this.getAllSlots();

    const floor1 = slots.filter((s) => s.floor === 1).sort((a, b) => a.sensor_index - b.sensor_index);
    const floor2 = slots.filter((s) => s.floor === 2).sort((a, b) => a.sensor_index - b.sensor_index);

    if (floor1.length === 2) {
      this.bridge.publishFloorLedCommand(1, [floor1[0].led_mode, floor1[1].led_mode]);
    }
    if (floor2.length === 2) {
      this.bridge.publishFloorLedCommand(2, [floor2[0].led_mode, floor2[1].led_mode]);
    }

    const freeCount = slots.filter((s) => s.status === 'FREE').length;
    const oledSlotCodes = slots.map((s) => statusToOledCode(s.status));
    const statusText = freeCount > 0 ? `CON ${freeCount} CHO` : 'BAI DAY';
    this.bridge.publishGateDisplay(freeCount, slots.length, oledSlotCodes, statusText);
  }

  handleFloorTelemetry(floor: number, items: FloorTelemetryItem[]): void {
    const now = new Date().toISOString();
    const updateStmt = this.db.prepare(
      'UPDATE slots SET sensor_occupied = ?, distance_cm = ?, updated_at = ? WHERE floor = ? AND sensor_index = ?',
    );
    for (const item of items) {
      updateStmt.run(item.occupied ? 1 : 0, Math.round(item.distanceCm), now, floor, item.index);
    }
    this.recomputeAndSyncAll();
  }

  setMaintenance(slotId: string, maintenance: boolean): EnrichedSlot[] {
    const slot = this.db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId) as unknown as SlotRow | undefined;
    if (!slot) {
      throw new Error(`Không tìm thấy ô đỗ ${slotId}`);
    }
    const now = new Date().toISOString();
    if (maintenance) {
      this.db
        .prepare("UPDATE slots SET status = 'MAINTENANCE', led_mode = 2, updated_at = ? WHERE id = ?")
        .run(now, slotId);
    } else {
      this.db
        .prepare("UPDATE slots SET status = 'FREE', led_mode = 0, updated_at = ? WHERE id = ?")
        .run(now, slotId);
    }
    return this.recomputeAndSyncAll();
  }
}
