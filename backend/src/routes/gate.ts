import { Router } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { getSettings } from '../db/database';
import { AuthedRequest, requireRole } from '../middleware/auth';
import { calculateSessionFee } from '../services/billingService';
import { GateService } from '../services/gateService';
import { SlotService } from '../services/slotService';
import { OvernightRequestRow, ParkingSessionRow, ReservationRow } from '../types/models';
import { WsHub } from '../ws/hub';

const scanQrSchema = z.object({
  qrCode: z.string().trim().min(1),
});

const barrierCmdSchema = z.object({
  action: z.enum(['OPEN_HOLD', 'OPEN_AUTO', 'CLOSE']),
  reason: z.string().trim().max(32).optional(),
});

function extractQrSecret(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof obj.gate === 'string') return obj.gate.trim();
      if (typeof obj.secret === 'string') return obj.secret.trim();
    } catch {
      // fall through
    }
  }
  return trimmed;
}

export function createGateRouter(
  db: DatabaseSync,
  gateService: GateService,
  slotService: SlotService,
  wsHub: WsHub,
  requireAuth: ReturnType<typeof import('../middleware/auth').createAuthMiddleware>,
) {
  const router = Router();

  router.get('/status', requireAuth, (req: AuthedRequest, res) => {
    const settings = getSettings(db);
    res.json({
      ...gateService.getStatus(),
      gateQrValue: req.auth!.role === 'OPERATOR' ? settings.gate_qr_secret : undefined,
    });
  });

  router.get('/logs', requireAuth, (req: AuthedRequest, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    if (req.auth!.role === 'OPERATOR') {
      res.json({ logs: gateService.getLogs(limit) });
      return;
    }
    const rows = db
      .prepare('SELECT * FROM gate_logs WHERE actor_uid = ? ORDER BY id DESC LIMIT ?')
      .all(req.auth!.uid, limit);
    res.json({ logs: rows });
  });

  router.post('/barrier', requireAuth, requireRole('OPERATOR'), (req: AuthedRequest, res) => {
    const parsed = barrierCmdSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Lệnh điều khiển barrier không hợp lệ' });
      return;
    }

    const { action, reason } = parsed.data;
    const displayLine =
      action === 'CLOSE'
        ? 'DONG CONG'
        : action === 'OPEN_HOLD'
          ? 'MO GIU CONG'
          : 'MO CONG';

    const log = gateService.commandBarrier({
      action,
      reason: reason || `OP_${action}`,
      displayLine,
      actorRole: 'OPERATOR',
      actorUid: req.auth!.uid,
      eventType: `OPERATOR_${action}`,
      detail: `Điều hành viên ${req.currentUser?.fullName} thực hiện ${action}`,
    });

    res.json({
      success: true,
      gate: gateService.getStatus(),
      log,
    });
  });

  router.post('/scan-qr', requireAuth, (req: AuthedRequest, res) => {
    const parsed = scanQrSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Mã QR không hợp lệ' });
      return;
    }

    const settings = getSettings(db);
    const scannedSecret = extractQrSecret(parsed.data.qrCode);
    if (scannedSecret !== settings.gate_qr_secret) {
      res.status(400).json({ error: 'Mã QR không đúng mã cổng bãi đỗ xe' });
      return;
    }

    const user = req.currentUser!;
    const now = new Date();
    const nowIso = now.toISOString();

    const openSession = db
      .prepare(
        `SELECT * FROM parking_sessions
         WHERE user_id = ? AND status != 'COMPLETED'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(user.id) as unknown as ParkingSessionRow | undefined;

    if (!openSession) {
      // CHECK-IN
      const activeRes = db
        .prepare(
          `SELECT * FROM reservations
           WHERE user_id = ? AND status = 'ACTIVE'
           ORDER BY id DESC LIMIT 1`,
        )
        .get(user.id) as unknown as ReservationRow | undefined;

      if (!activeRes) {
        const usableSlotsRow = db
          .prepare("SELECT COUNT(*) AS cnt FROM slots WHERE status != 'MAINTENANCE'")
          .get() as { cnt: number };
        const openSessionsRow = db
          .prepare("SELECT COUNT(*) AS cnt FROM parking_sessions WHERE status != 'COMPLETED'")
          .get() as { cnt: number };
        const otherActiveResRow = db
          .prepare("SELECT COUNT(*) AS cnt FROM reservations WHERE status = 'ACTIVE' AND user_id != ?")
          .get(user.id) as { cnt: number };

        const availableCapacity =
          usableSlotsRow.cnt - openSessionsRow.cnt - otherActiveResRow.cnt;
        if (availableCapacity <= 0) {
          res.status(400).json({ error: 'Bãi xe hiện đã hết chỗ trống' });
          return;
        }
      }

      const pendingOvernight = db
        .prepare(
          `SELECT * FROM overnight_requests
           WHERE user_id = ? AND status = 'APPROVED' AND session_id IS NULL
           ORDER BY id DESC LIMIT 1`,
        )
        .get(user.id) as unknown as OvernightRequestRow | undefined;

      const slotId = activeRes?.slot_id ?? null;
      const hasOvernight = pendingOvernight ? 1 : 0;

      const insertRes = db
        .prepare(
          `INSERT INTO parking_sessions (
             user_id, slot_id, reservation_id, check_in_time, status, has_overnight_request
           ) VALUES (?, ?, ?, ?, 'ACTIVE', ?)`,
        )
        .run(user.id, slotId, activeRes?.id ?? null, nowIso, hasOvernight);

      const sessionId = Number(insertRes.lastInsertRowid);
      if (activeRes) {
        db.prepare("UPDATE reservations SET status = 'FULFILLED' WHERE id = ?").run(activeRes.id);
      }
      if (pendingOvernight) {
        db.prepare('UPDATE overnight_requests SET session_id = ?, slot_id = ? WHERE id = ?').run(
          sessionId,
          slotId,
          pendingOvernight.id,
        );
      }

      const session = db
        .prepare('SELECT * FROM parking_sessions WHERE id = ?')
        .get(sessionId) as unknown as ParkingSessionRow;

      gateService.commandBarrier({
        action: 'OPEN_AUTO',
        reason: 'QR_CHECK_IN',
        displayLine: `VAO: ${user.uid}`.slice(0, 21),
        actorRole: 'USER',
        actorUid: user.uid,
        eventType: 'QR_CHECK_IN',
        detail: `Xe ${user.licensePlate || user.username} (${user.uid}) quét QR vào cổng`,
      });

      slotService.recomputeAndSyncAll();
      wsHub.broadcast('SESSIONS_UPDATED', { sessionId: session.id, userId: user.id });

      res.json({
        action: 'CHECK_IN',
        message: 'Xác minh UID thành công! Barrier đang mở cho xe vào.',
        session,
        feeBreakdown: null,
      });
      return;
    }

    // CHECK-OUT -> tinh tien & chuyen sang PENDING_PAYMENT (chua mo barrier cho den khi thanh toan)
    const checkOutDate = openSession.check_out_time ? new Date(openSession.check_out_time) : now;
    const fee = calculateSessionFee(openSession, settings, checkOutDate);
    const checkOutIso = checkOutDate.toISOString();

    db.prepare(
      `UPDATE parking_sessions
       SET status = 'PENDING_PAYMENT',
           check_out_time = ?,
           base_fee = ?,
           overnight_fee = ?,
           penalty_fee = ?,
           total_fee = ?
       WHERE id = ?`,
    ).run(
      checkOutIso,
      fee.baseFee,
      fee.overnightFee,
      fee.penaltyFee,
      fee.totalFee,
      openSession.id,
    );

    const updatedSession = db
      .prepare('SELECT * FROM parking_sessions WHERE id = ?')
      .get(openSession.id) as unknown as ParkingSessionRow;

    wsHub.broadcast('SESSIONS_UPDATED', { sessionId: updatedSession.id, userId: user.id });

    res.json({
      action: 'CHECK_OUT_PAYMENT_REQUIRED',
      message: 'Đã tính phí đỗ xe. Vui lòng thanh toán để mở barrier ra.',
      session: updatedSession,
      feeBreakdown: fee,
    });
  });

  return router;
}
