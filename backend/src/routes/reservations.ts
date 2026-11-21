import { Router } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { getSettings } from '../db/database';
import { AuthedRequest } from '../middleware/auth';
import { SlotService } from '../services/slotService';
import { ReservationRow, SlotRow } from '../types/models';
import { WsHub } from '../ws/hub';

const createReservationSchema = z.object({
  slotId: z.string().trim().min(1),
  note: z.string().trim().max(200).optional(),
});

export function createReservationsRouter(
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
          `SELECT r.*, u.uid, u.full_name, u.license_plate
           FROM reservations r
           JOIN users u ON u.id = r.user_id
           ORDER BY r.id DESC
           LIMIT 100`,
        )
        .all();
      res.json({ reservations: rows });
      return;
    }

    const rows = db
      .prepare(
        `SELECT r.*, u.uid, u.full_name, u.license_plate
         FROM reservations r
         JOIN users u ON u.id = r.user_id
         WHERE r.user_id = ?
         ORDER BY r.id DESC
         LIMIT 50`,
      )
      .all(req.auth!.userId);
    res.json({ reservations: rows });
  });

  router.post('/', requireAuth, (req: AuthedRequest, res) => {
    const parsed = createReservationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Vui lòng chọn ô đỗ hợp lệ' });
      return;
    }

    const { slotId, note } = parsed.data;
    const userId = req.auth!.userId;

    const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slotId) as unknown as SlotRow | undefined;
    if (!slot) {
      res.status(404).json({ error: 'Không tìm thấy ô đỗ' });
      return;
    }

    if (slot.status !== 'FREE') {
      res.status(400).json({ error: `Ô ${slot.id} hiện không trống (${slot.status})` });
      return;
    }

    const existingUserRes = db
      .prepare("SELECT id FROM reservations WHERE user_id = ? AND status = 'ACTIVE'")
      .get(userId);
    if (existingUserRes) {
      res.status(400).json({ error: 'Bạn đang có một lịch giữ chỗ đang hoạt động' });
      return;
    }

    const existingUserSession = db
      .prepare("SELECT id FROM parking_sessions WHERE user_id = ? AND status != 'COMPLETED'")
      .get(userId);
    if (existingUserSession) {
      res.status(400).json({ error: 'Bạn đang gửi xe trong bãi, không thể đặt lịch mới' });
      return;
    }

    const settings = getSettings(db);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + settings.reservation_hold_minutes * 60000);

    const result = db
      .prepare(
        `INSERT INTO reservations (user_id, slot_id, status, reserved_at, expires_at, note)
         VALUES (?, ?, 'ACTIVE', ?, ?, ?)`,
      )
      .run(userId, slotId, now.toISOString(), expiresAt.toISOString(), note ?? null);

    const reservation = db
      .prepare('SELECT * FROM reservations WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as unknown as ReservationRow;

    const slots = slotService.recomputeAndSyncAll();
    wsHub.broadcast('RESERVATIONS_UPDATED', { reservation });

    res.status(201).json({ reservation, slots });
  });

  router.delete('/:id', requireAuth, (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID đặt lịch không hợp lệ' });
      return;
    }

    const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) as unknown as
      | ReservationRow
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Không tìm thấy lịch đặt chỗ' });
      return;
    }

    if (req.auth!.role !== 'OPERATOR' && row.user_id !== req.auth!.userId) {
      res.status(403).json({ error: 'Bạn không có quyền hủy lịch đặt này' });
      return;
    }

    if (row.status !== 'ACTIVE') {
      res.status(400).json({ error: 'Chỉ có thể hủy lịch đặt đang ở trạng thái ACTIVE' });
      return;
    }

    db.prepare("UPDATE reservations SET status = 'CANCELLED' WHERE id = ?").run(id);
    const slots = slotService.recomputeAndSyncAll();
    wsHub.broadcast('RESERVATIONS_UPDATED', { cancelledId: id });

    res.json({ success: true, slots });
  });

  return router;
}
