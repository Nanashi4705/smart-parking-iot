import { DatabaseSync } from 'node:sqlite';
import { getSettings } from '../db/database';
import { ParkingSessionRow } from '../types/models';
import { WsHub } from '../ws/hub';
import { calculateSessionFee } from './billingService';
import { SlotService } from './slotService';

export class ParkingScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private db: DatabaseSync,
    private slotService: SlotService,
    private wsHub: WsHub,
  ) {}

  start(intervalMs = 5000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.runTick();
      } catch (err) {
        console.error('[Scheduler] Tick error:', err);
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  runTick(now: Date = new Date()): { expiredReservations: number; overtimeSessions: number } {
    const nowIso = now.toISOString();
    const settings = getSettings(this.db);
    let changed = false;

    const expiredRes = this.db
      .prepare(
        `UPDATE reservations SET status = 'EXPIRED'
         WHERE status = 'ACTIVE' AND expires_at <= ?`,
      )
      .run(nowIso);
    const expiredReservations = Number(expiredRes.changes);
    if (expiredReservations > 0) {
      changed = true;
    }

    const activeSessions = this.db
      .prepare(
        `SELECT * FROM parking_sessions
         WHERE status = 'ACTIVE' AND has_overnight_request = 0`,
      )
      .all() as unknown as ParkingSessionRow[];

    let overtimeSessions = 0;
    const updateOvertimeStmt = this.db.prepare(
      `UPDATE parking_sessions
       SET status = 'OVERTIME', base_fee = ?, overnight_fee = ?, penalty_fee = ?, total_fee = ?
       WHERE id = ?`,
    );

    for (const session of activeSessions) {
      const elapsedMinutes = (now.getTime() - new Date(session.check_in_time).getTime()) / 60000;
      if (elapsedMinutes > settings.max_duration_minutes) {
        const fee = calculateSessionFee({ ...session, status: 'OVERTIME' }, settings, now);
        updateOvertimeStmt.run(
          fee.baseFee,
          fee.overnightFee,
          fee.penaltyFee,
          fee.totalFee,
          session.id,
        );
        overtimeSessions += 1;
        changed = true;
        this.wsHub.broadcast('SESSION_OVERTIME', {
          sessionId: session.id,
          userId: session.user_id,
          slotId: session.slot_id,
          penaltyFee: fee.penaltyFee,
          totalFee: fee.totalFee,
        });
      }
    }

    if (changed) {
      this.slotService.recomputeAndSyncAll();
    }

    return { expiredReservations, overtimeSessions };
  }
}
