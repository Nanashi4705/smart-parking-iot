import { Router } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { AuthedRequest, requireRole } from '../middleware/auth';
import { SlotService } from '../services/slotService';
import { OvernightRequestRow, ParkingSessionRow } from '../types/models';
import { WsHub } from '../ws/hub';

const createOvernightSchema = z.object({
  reason: z.string().trim().min(2).max(200),
});

const reviewOvernightSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  operatorNote: z.string().trim().max(300).optional(),
});

export function createOvernightRouter(
  db: DatabaseSync,
  slotService: SlotService,
  wsHub: WsHub,
  requireAuth: ReturnType<typeof import('../middleware/auth').createAuthMiddleware>,
) {
  const router = Router();

  router.get('/', requireAuth, (req: AuthedRequest, res) => {
    if (req.auth!.role === 'OPERATOR') {
      const rows = db
        .prepare(
          `SELECT o.*, u.uid, u.full_name, u.license_plate
           FROM overnight_requests o
           JOIN users u ON u.id = o.user_id
           ORDER BY CASE WHEN o.status = 'PENDING' THEN 0 ELSE 1 END, o.id DESC
           LIMIT 100`,
        )
        .all();
      res.json({ requests: rows });
      return;
    }

    const rows = db
      .prepare(
        `SELECT o.*, u.uid, u.full_name, u.license_plate
         FROM overnight_requests o
         JOIN users u ON u.id = o.user_id
         WHERE o.user_id = ?
         ORDER BY o.id DESC
         LIMIT 50`,
      )
      .all(req.auth!.userId);
    res.json({ requests: rows });
  });

  router.post('/', requireAuth, (req: AuthedRequest, res) => {
    const parsed = createOvernightSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Vui lòng nhập lý do để xe qua đêm (ít nhất 2 ký tự)' });
      return;
    }

    const userId = req.auth!.userId;
    const openSession = db
      .prepare(
        `SELECT * FROM parking_sessions
         WHERE user_id = ? AND status != 'COMPLETED'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(userId) as unknown as ParkingSessionRow | undefined;

    if (openSession) {
      if (openSession.status === 'OVERTIME') {
        res.status(400).json({
          error: 'Phiên gửi xe đã quá giờ quy định, không thể tạo yêu cầu qua đêm để xóa phạt',
        });
        return;
      }
      if (openSession.status === 'PENDING_PAYMENT') {
        res.status(400).json({ error: 'Phiên đang chờ thanh toán để ra cổng' });
        return;
      }
      if (openSession.has_overnight_request === 1) {
        res.status(400).json({ error: 'Phiên gửi xe hiện tại đã được duyệt qua đêm' });
        return;
      }

      const existingPending = db
        .prepare(
          `SELECT id FROM overnight_requests
           WHERE user_id = ? AND status = 'PENDING'`,
        )
        .get(userId);
      if (existingPending) {
        res.status(400).json({ error: 'Bạn đã có yêu cầu qua đêm đang chờ Người điều hành duyệt' });
        return;
      }

      const now = new Date().toISOString();
      const result = db
        .prepare(
          `INSERT INTO overnight_requests (user_id, session_id, slot_id, reason, status, created_at)
           VALUES (?, ?, ?, ?, 'PENDING', ?)`,
        )
        .run(userId, openSession.id, openSession.slot_id, parsed.data.reason, now);

      const request = db
        .prepare('SELECT * FROM overnight_requests WHERE id = ?')
        .get(Number(result.lastInsertRowid)) as unknown as OvernightRequestRow;

      wsHub.broadcast('OVERNIGHT_UPDATED', { request });
      res.status(201).json({ request, appliedToSessionId: null });
      return;
    }

    const existingReq = db
      .prepare(
        `SELECT id FROM overnight_requests
         WHERE user_id = ? AND status IN ('PENDING', 'APPROVED') AND session_id IS NULL`,
      )
      .get(userId);
    if (existingReq) {
      res.status(400).json({
        error: 'Bạn đã có yêu cầu qua đêm đang chờ duyệt hoặc chờ áp dụng khi vào cổng',
      });
      return;
    }

    const activeReservation = db
      .prepare(
        `SELECT slot_id FROM reservations
         WHERE user_id = ? AND status = 'ACTIVE'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(userId) as { slot_id: string } | undefined;

    const freeCount = slotService.getFreeCount();
    if (freeCount <= 0 && !activeReservation) {
      res.status(400).json({ error: 'Bãi xe hiện không còn chỗ trống để đăng ký qua đêm' });
      return;
    }

    const now = new Date().toISOString();
    const result = db
      .prepare(
        `INSERT INTO overnight_requests (user_id, session_id, slot_id, reason, status, created_at)
         VALUES (?, NULL, ?, ?, 'PENDING', ?)`,
      )
      .run(userId, activeReservation?.slot_id ?? null, parsed.data.reason, now);

    const request = db
      .prepare('SELECT * FROM overnight_requests WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as unknown as OvernightRequestRow;

    wsHub.broadcast('OVERNIGHT_UPDATED', { request });
    res.status(201).json({ request, appliedToSessionId: null });
  });

  router.patch('/:id/review', requireAuth, requireRole('OPERATOR'), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID yêu cầu qua đêm không hợp lệ' });
      return;
    }

    const parsed = reviewOvernightSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Quyết định duyệt phải là APPROVED hoặc REJECTED' });
      return;
    }

    const row = db.prepare('SELECT * FROM overnight_requests WHERE id = ?').get(id) as unknown as
      | OvernightRequestRow
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Không tìm thấy yêu cầu qua đêm' });
      return;
    }
    if (row.status !== 'PENDING') {
      res.status(400).json({ error: `Yêu cầu này đã ở trạng thái ${row.status}` });
      return;
    }

    const now = new Date().toISOString();
    const { decision, operatorNote } = parsed.data;

    db.prepare(
      `UPDATE overnight_requests
       SET status = ?, operator_note = ?, reviewed_at = ?
       WHERE id = ?`,
    ).run(decision, operatorNote ?? null, now, id);

    if (decision === 'APPROVED') {
      const openSession = (
        row.session_id
          ? db
              .prepare("SELECT * FROM parking_sessions WHERE id = ? AND status != 'COMPLETED'")
              .get(row.session_id)
          : db
              .prepare(
                `SELECT * FROM parking_sessions
                 WHERE user_id = ? AND status != 'COMPLETED'
                 ORDER BY id DESC LIMIT 1`,
              )
              .get(row.user_id)
      ) as unknown as ParkingSessionRow | undefined;

      if (openSession) {
        db.prepare('UPDATE overnight_requests SET session_id = ?, slot_id = ? WHERE id = ?').run(
          openSession.id,
          openSession.slot_id,
          id,
        );

        if (openSession.status === 'OVERTIME') {
          db.prepare(
            `UPDATE parking_sessions
             SET has_overnight_request = 1,
                 status = 'ACTIVE',
                 base_fee = 0,
                 overnight_fee = 0,
                 penalty_fee = 0,
                 total_fee = 0
             WHERE id = ?`,
          ).run(openSession.id);
          slotService.recomputeAndSyncAll();
        } else {
          db.prepare('UPDATE parking_sessions SET has_overnight_request = 1 WHERE id = ?').run(
            openSession.id,
          );
        }
      }
    }

    const updated = db
      .prepare('SELECT * FROM overnight_requests WHERE id = ?')
      .get(id) as unknown as OvernightRequestRow;

    wsHub.broadcast('OVERNIGHT_UPDATED', { request: updated });
    wsHub.broadcast('SESSIONS_UPDATED', { userId: row.user_id });

    res.json({ request: updated });
  });

  router.delete('/:id', requireAuth, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID không hợp lệ' });
      return;
    }

    const row = db.prepare('SELECT * FROM overnight_requests WHERE id = ?').get(id) as unknown as
      | OvernightRequestRow
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Không tìm thấy yêu cầu qua đêm' });
      return;
    }
    if (req.auth!.role !== 'OPERATOR' && row.user_id !== req.auth!.userId) {
      res.status(403).json({ error: 'Không có quyền hủy yêu cầu này' });
      return;
    }
    const cancellable =
      row.status === 'PENDING' || (row.status === 'APPROVED' && row.session_id === null);
    if (!cancellable) {
      res.status(400).json({ error: 'Không thể hủy yêu cầu đã được áp dụng vào phiên gửi xe' });
      return;
    }

    db.prepare("UPDATE overnight_requests SET status = 'CANCELLED' WHERE id = ?").run(id);
    wsHub.broadcast('OVERNIGHT_UPDATED', { cancelledId: id });
    res.json({ success: true });
  });

  return router;
}
