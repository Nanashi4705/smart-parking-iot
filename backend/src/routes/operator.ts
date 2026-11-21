import { Router } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { AuthedRequest, requireRole } from '../middleware/auth';
import { SlotService } from '../services/slotService';
import { ParkingSessionRow, ReservationRow, SlotRow } from '../types/models';
import { WsHub } from '../ws/hub';

const maintenanceSchema = z.object({
  maintenance: z.boolean(),
});

const assignSessionSlotSchema = z.object({
  slotId: z.string().trim().min(1).nullable(),
});

const reassignReservationSchema = z.object({
  slotId: z.string().trim().min(1),
});

export function createOperatorRouter(
  db: DatabaseSync,
  slotService: SlotService,
  wsHub: WsHub,
  requireAuth: ReturnType<typeof import('../middleware/auth').createAuthMiddleware>,
) {
  const router = Router();
  router.use(requireAuth, requireRole('OPERATOR'));

  router.get('/overview', (_req: AuthedRequest, res) => {
    const slots = slotService.getAllSlots();
    const freeCount = slots.filter((s) => s.status === 'FREE').length;
    const activeSessionsCount = (
      db
        .prepare("SELECT COUNT(*) AS cnt FROM parking_sessions WHERE status != 'COMPLETED'")
        .get() as { cnt: number }
    ).cnt;
    const overtimeCount = (
      db
        .prepare("SELECT COUNT(*) AS cnt FROM parking_sessions WHERE status = 'OVERTIME'")
        .get() as { cnt: number }
    ).cnt;
    const activeReservationsCount = (
      db
        .prepare("SELECT COUNT(*) AS cnt FROM reservations WHERE status = 'ACTIVE'")
        .get() as { cnt: number }
    ).cnt;
    const openFaultsCount = (
      db
        .prepare("SELECT COUNT(*) AS cnt FROM fault_reports WHERE status != 'RESOLVED'")
        .get() as { cnt: number }
    ).cnt;
    const pendingOvernightCount = (
      db
        .prepare("SELECT COUNT(*) AS cnt FROM overnight_requests WHERE status = 'PENDING'")
        .get() as { cnt: number }
    ).cnt;
    const totalRevenueVnd = (
      db
        .prepare("SELECT COALESCE(SUM(total_fee), 0) AS total FROM parking_sessions WHERE status = 'COMPLETED'")
        .get() as { total: number }
    ).total;

    res.json({
      freeCount,
      totalCount: slots.length,
      activeSessionsCount,
      overtimeCount,
      activeReservationsCount,
      openFaultsCount,
      pendingOvernightCount,
      totalRevenueVnd,
    });
  });

  router.patch('/slots/:id/maintenance', (req, res) => {
    const parsed = maintenanceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Thiếu trường maintenance (boolean)' });
      return;
    }

    try {
      const slots = slotService.setMaintenance(req.params.id, parsed.data.maintenance);
      res.json({ slots });
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  router.post('/sessions/:id/assign-slot', (req, res) => {
    const sessionId = Number(req.params.id);
    if (!Number.isInteger(sessionId)) {
      res.status(400).json({ error: 'ID phiên không hợp lệ' });
      return;
    }

    const parsed = assignSessionSlotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Dữ liệu slotId không hợp lệ' });
      return;
    }

    const session = db
      .prepare('SELECT * FROM parking_sessions WHERE id = ?')
      .get(sessionId) as unknown as ParkingSessionRow | undefined;
    if (!session || session.status === 'COMPLETED') {
      res.status(404).json({ error: 'Không tìm thấy phiên gửi xe đang mở' });
      return;
    }

    const targetSlotId = parsed.data.slotId;
    if (targetSlotId !== null) {
      const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(targetSlotId) as unknown as
        | SlotRow
        | undefined;
      if (!slot) {
        res.status(404).json({ error: 'Không tìm thấy ô đỗ đích' });
        return;
      }
      if (slot.status === 'MAINTENANCE') {
        res.status(400).json({ error: `Ô ${targetSlotId} đang khóa bảo trì` });
        return;
      }

      const conflictingSession = db
        .prepare(
          `SELECT id FROM parking_sessions
           WHERE slot_id = ? AND status != 'COMPLETED' AND id != ?`,
        )
        .get(targetSlotId, sessionId);
      if (conflictingSession) {
        res.status(400).json({ error: `Ô ${targetSlotId} đang được gắn cho phiên gửi xe khác` });
        return;
      }

      const conflictingReservation = db
        .prepare(
          `SELECT id FROM reservations
           WHERE slot_id = ? AND status = 'ACTIVE' AND user_id != ?`,
        )
        .get(targetSlotId, session.user_id);
      if (conflictingReservation) {
        res.status(400).json({ error: `Ô ${targetSlotId} đang được đặt lịch bởi người khác` });
        return;
      }
    }

    db.prepare('UPDATE parking_sessions SET slot_id = ? WHERE id = ?').run(targetSlotId, sessionId);
    const slots = slotService.recomputeAndSyncAll();
    wsHub.broadcast('SESSIONS_UPDATED', { sessionId });

    const updated = db.prepare('SELECT * FROM parking_sessions WHERE id = ?').get(sessionId);
    res.json({ session: updated, slots });
  });

  router.post('/reservations/:id/reassign-slot', (req, res) => {
    const reservationId = Number(req.params.id);
    if (!Number.isInteger(reservationId)) {
      res.status(400).json({ error: 'ID đặt lịch không hợp lệ' });
      return;
    }

    const parsed = reassignReservationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Vui lòng chọn ô đỗ mới' });
      return;
    }

    const reservation = db
      .prepare('SELECT * FROM reservations WHERE id = ?')
      .get(reservationId) as unknown as ReservationRow | undefined;
    if (!reservation || reservation.status !== 'ACTIVE') {
      res.status(404).json({ error: 'Không tìm thấy lịch đặt đang hoạt động' });
      return;
    }

    const targetSlot = db
      .prepare('SELECT * FROM slots WHERE id = ?')
      .get(parsed.data.slotId) as unknown as SlotRow | undefined;
    if (!targetSlot) {
      res.status(404).json({ error: 'Không tìm thấy ô đỗ đích' });
      return;
    }
    if (targetSlot.status !== 'FREE') {
      res.status(400).json({ error: `Ô ${targetSlot.id} hiện không trống (${targetSlot.status})` });
      return;
    }

    db.prepare('UPDATE reservations SET slot_id = ? WHERE id = ?').run(targetSlot.id, reservationId);
    const slots = slotService.recomputeAndSyncAll();
    wsHub.broadcast('RESERVATIONS_UPDATED', { reservationId });

    const updated = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
    res.json({ reservation: updated, slots });
  });

  return router;
}
