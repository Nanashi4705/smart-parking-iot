import { Router } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { getSettings } from '../db/database';
import { AuthedRequest } from '../middleware/auth';
import { calculateSessionFee } from '../services/billingService';
import { GateService } from '../services/gateService';
import { SlotService } from '../services/slotService';
import { ParkingSessionRow, UserRow } from '../types/models';
import { WsHub } from '../ws/hub';

const paySchema = z.object({
  paymentMethod: z.enum(['WALLET', 'MOCK_QR']),
});

export function createSessionsRouter(
  db: DatabaseSync,
  gateService: GateService,
  slotService: SlotService,
  wsHub: WsHub,
  requireAuth: ReturnType<typeof import('../middleware/auth').createAuthMiddleware>,
) {
  const router = Router();

  router.get('/', requireAuth, (req: AuthedRequest, res) => {
    const settings = getSettings(db);
    const now = new Date();
    const rows =
      req.auth!.role === 'OPERATOR'
        ? (db
            .prepare(
              `SELECT s.*, u.uid, u.full_name, u.license_plate
               FROM parking_sessions s
               JOIN users u ON u.id = s.user_id
               ORDER BY s.id DESC
               LIMIT 100`,
            )
            .all() as unknown as Array<ParkingSessionRow & { uid: string; full_name: string; license_plate: string }>)
        : (db
            .prepare(
              `SELECT s.*, u.uid, u.full_name, u.license_plate
               FROM parking_sessions s
               JOIN users u ON u.id = s.user_id
               WHERE s.user_id = ?
               ORDER BY s.id DESC
               LIMIT 50`,
            )
            .all(req.auth!.userId) as unknown as Array<
            ParkingSessionRow & { uid: string; full_name: string; license_plate: string }
          >);

    const enriched = rows.map((row) => ({
      ...row,
      liveFee:
        row.status === 'COMPLETED'
          ? {
              durationMinutes: Math.max(
                1,
                Math.ceil(
                  (new Date(row.check_out_time || row.paid_at || now).getTime() -
                    new Date(row.check_in_time).getTime()) /
                    60000,
                ),
              ),
              isOvertime: row.penalty_fee > 0,
              baseFee: row.base_fee,
              overnightFee: row.overnight_fee,
              penaltyFee: row.penalty_fee,
              totalFee: row.total_fee,
            }
          : calculateSessionFee(
              row,
              settings,
              row.check_out_time ? new Date(row.check_out_time) : now,
            ),
    }));

    res.json({ sessions: enriched });
  });

  router.get('/active', requireAuth, (req: AuthedRequest, res) => {
    const row = db
      .prepare(
        `SELECT * FROM parking_sessions
         WHERE user_id = ? AND status != 'COMPLETED'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(req.auth!.userId) as unknown as ParkingSessionRow | undefined;

    if (!row) {
      res.json({ session: null, liveFee: null });
      return;
    }

    const settings = getSettings(db);
    const liveFee = calculateSessionFee(
      row,
      settings,
      row.check_out_time ? new Date(row.check_out_time) : new Date(),
    );
    res.json({ session: row, liveFee });
  });

  router.post('/:id/pay', requireAuth, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID phiên gửi xe không hợp lệ' });
      return;
    }

    const parsed = paySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Phương thức thanh toán phải là WALLET hoặc MOCK_QR' });
      return;
    }

    const session = db.prepare('SELECT * FROM parking_sessions WHERE id = ?').get(id) as unknown as
      | ParkingSessionRow
      | undefined;
    if (!session) {
      res.status(404).json({ error: 'Không tìm thấy phiên gửi xe' });
      return;
    }

    if (req.auth!.role !== 'OPERATOR' && session.user_id !== req.auth!.userId) {
      res.status(403).json({ error: 'Không có quyền thanh toán phiên này' });
      return;
    }

    if (session.status === 'COMPLETED') {
      res.status(400).json({ error: 'Phiên gửi xe này đã được thanh toán trước đó' });
      return;
    }

    const settings = getSettings(db);
    const now = new Date();
    const checkOutDate = session.check_out_time ? new Date(session.check_out_time) : now;
    const fee = calculateSessionFee(session, settings, checkOutDate);

    const payer = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as unknown as UserRow;
    if (parsed.data.paymentMethod === 'WALLET') {
      if (payer.wallet_balance < fee.totalFee) {
        res.status(400).json({
          error: `Số dư ví (${payer.wallet_balance.toLocaleString('vi-VN')}đ) không đủ thanh toán ${fee.totalFee.toLocaleString('vi-VN')}đ`,
        });
        return;
      }
      db.prepare('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?').run(
        fee.totalFee,
        payer.id,
      );
    }

    const nowIso = now.toISOString();
    db.prepare(
      `UPDATE parking_sessions
       SET status = 'COMPLETED',
           check_out_time = COALESCE(check_out_time, ?),
           base_fee = ?,
           overnight_fee = ?,
           penalty_fee = ?,
           total_fee = ?,
           paid_at = ?,
           payment_method = ?
       WHERE id = ?`,
    ).run(
      checkOutDate.toISOString(),
      fee.baseFee,
      fee.overnightFee,
      fee.penaltyFee,
      fee.totalFee,
      nowIso,
      parsed.data.paymentMethod,
      session.id,
    );

    db.prepare(
      `UPDATE overnight_requests SET status = 'COMPLETED' WHERE session_id = ? AND status = 'APPROVED'`,
    ).run(session.id);

    const updatedSession = db
      .prepare('SELECT * FROM parking_sessions WHERE id = ?')
      .get(session.id) as unknown as ParkingSessionRow;

    const updatedUser = db
      .prepare('SELECT wallet_balance FROM users WHERE id = ?')
      .get(payer.id) as { wallet_balance: number };

    gateService.commandBarrier({
      action: 'OPEN_AUTO',
      reason: 'QR_CHECK_OUT_PAID',
      displayLine: `RA: ${payer.uid}`.slice(0, 21),
      actorRole: req.auth!.role,
      actorUid: payer.uid,
      eventType: 'QR_CHECK_OUT',
      detail: `Thanh toán ${fee.totalFee.toLocaleString('vi-VN')}đ (${parsed.data.paymentMethod}) - Mở barrier cho ${payer.uid}`,
    });

    slotService.recomputeAndSyncAll();
    wsHub.broadcast('SESSIONS_UPDATED', { sessionId: session.id, userId: payer.id });

    res.json({
      success: true,
      message: 'Thanh toán thành công! Barrier đang mở cho xe ra.',
      session: updatedSession,
      feeBreakdown: fee,
      walletBalance: updatedUser.wallet_balance,
    });
  });

  return router;
}
