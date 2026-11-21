import { DatabaseSync } from 'node:sqlite';
import { GateLogRow } from '../types/models';
import { WsHub } from '../ws/hub';
import { MqttPublisherBridge } from './slotService';

export type BarrierState = 'CLOSED' | 'OPEN_AUTO' | 'OPEN_HOLD' | 'EMERGENCY_OPEN';

export interface GatewayStatus {
  online: boolean;
  ip: string | null;
  channel: number | null;
  lastSeen: string | null;
}

export interface GateTelemetryPayload {
  eventType: string;
  barrierOpen?: boolean;
  carAtGate?: boolean;
  gateDistanceCm?: number;
  rfidUid?: string;
}

export class GateService {
  private bridge: MqttPublisherBridge | null = null;
  private barrierState: BarrierState = 'CLOSED';
  private carAtGate = false;
  private gateDistanceCm = 999;
  private gatewayStatus: GatewayStatus = {
    online: false,
    ip: null,
    channel: null,
    lastSeen: null,
  };

  constructor(
    private db: DatabaseSync,
    private wsHub: WsHub,
  ) {}

  attachMqttBridge(bridge: MqttPublisherBridge): void {
    this.bridge = bridge;
  }

  getStatus() {
    return {
      barrierState: this.barrierState,
      carAtGate: this.carAtGate,
      gateDistanceCm: this.gateDistanceCm,
      gateway: this.gatewayStatus,
    };
  }

  getLogs(limit = 50): GateLogRow[] {
    return this.db
      .prepare('SELECT * FROM gate_logs ORDER BY id DESC LIMIT ?')
      .all(limit) as unknown as GateLogRow[];
  }

  recordLog(params: {
    eventType: string;
    actorRole: string;
    actorUid?: string | null;
    rfidUid?: string | null;
    detail?: string | null;
  }): GateLogRow {
    const now = new Date().toISOString();
    const res = this.db
      .prepare(
        `INSERT INTO gate_logs (event_type, actor_role, actor_uid, rfid_uid, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.eventType,
        params.actorRole,
        params.actorUid ?? null,
        params.rfidUid ?? null,
        params.detail ?? null,
        now,
      );
    const row = this.db
      .prepare('SELECT * FROM gate_logs WHERE id = ?')
      .get(Number(res.lastInsertRowid)) as unknown as GateLogRow;
    return row;
  }

  commandBarrier(params: {
    action: 'CLOSE' | 'OPEN_AUTO' | 'OPEN_HOLD';
    reason: string;
    displayLine: string;
    actorRole: 'USER' | 'OPERATOR' | 'SYSTEM';
    actorUid?: string | null;
    eventType?: string;
    detail?: string;
  }): GateLogRow {
    if (params.action === 'CLOSE') {
      this.barrierState = 'CLOSED';
    } else if (params.action === 'OPEN_HOLD') {
      this.barrierState = 'OPEN_HOLD';
    } else {
      this.barrierState = 'OPEN_AUTO';
    }

    const log = this.recordLog({
      eventType: params.eventType ?? `BARRIER_CMD_${params.action}`,
      actorRole: params.actorRole,
      actorUid: params.actorUid ?? null,
      detail: params.detail ?? params.reason,
    });

    if (this.bridge) {
      this.bridge.publishGateCommand(params.action, params.reason, params.displayLine);
    }

    this.wsHub.broadcast('GATE_UPDATED', {
      ...this.getStatus(),
      lastLog: log,
    });

    return log;
  }

  updateGatewayStatus(status: { online: boolean; ip?: string; channel?: number }): void {
    this.gatewayStatus = {
      online: status.online,
      ip: status.ip ?? this.gatewayStatus.ip,
      channel: status.channel ?? this.gatewayStatus.channel,
      lastSeen: new Date().toISOString(),
    };
    this.wsHub.broadcast('GATE_UPDATED', this.getStatus());
  }

  handleGateEvent(payload: GateTelemetryPayload): void {
    if (typeof payload.carAtGate === 'boolean') {
      this.carAtGate = payload.carAtGate;
    }
    if (typeof payload.gateDistanceCm === 'number') {
      this.gateDistanceCm = payload.gateDistanceCm;
    }

    if (payload.eventType === 'RFID_EMERGENCY_OPEN') {
      this.barrierState = 'EMERGENCY_OPEN';
    } else if (
      payload.eventType === 'RFID_EMERGENCY_CLOSE' ||
      payload.eventType === 'BARRIER_CLOSED'
    ) {
      this.barrierState = 'CLOSED';
    } else if (payload.eventType === 'BARRIER_OPENED' && payload.barrierOpen) {
      if (this.barrierState === 'CLOSED') {
        this.barrierState = 'OPEN_AUTO';
      }
    }

    const isRfid = payload.eventType.startsWith('RFID_');
    const log = this.recordLog({
      eventType: payload.eventType,
      actorRole: isRfid ? 'RFID' : 'SYSTEM',
      rfidUid: payload.rfidUid || null,
      detail:
        payload.eventType === 'RFID_EMERGENCY_OPEN'
          ? `Mở barrier khẩn cấp bằng thẻ Master (${payload.rfidUid || 'N/A'})`
          : payload.eventType === 'RFID_EMERGENCY_CLOSE'
            ? `Đóng barrier khẩn cấp bằng thẻ Master (${payload.rfidUid || 'N/A'})`
            : payload.eventType === 'RFID_DENIED'
              ? `Từ chối thẻ RFID lạ (${payload.rfidUid || 'N/A'})`
              : payload.eventType === 'BARRIER_BLOCKED'
                ? 'Không thể đóng barrier: phát hiện vật cản dưới cần chắn'
                : `Sự kiện cổng: ${payload.eventType}`,
    });

    this.wsHub.broadcast('GATE_UPDATED', {
      ...this.getStatus(),
      lastLog: log,
    });
  }
}
