import { Router } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { AuthedRequest, requireRole } from '../middleware/auth';
import { FaultReportRow } from '../types/models';
import { WsHub } from '../ws/hub';

const createFaultSchema = z.object({
  slotId: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(2).max(500),
});

const updateFaultSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']),
  operatorNote: z.string().trim().max(500).optional(),
});

export function createFaultReportsRouter(
  db: DatabaseSync,
  wsHub: WsHub,
  requireAuth: ReturnType<typeof import('../middleware/auth').createAuthMiddleware>,
) {
  const router = Router();

  router.get('/', requireAuth, (req: AuthedRequest, res) => {
    const baseQuery = `
      SELECT f.*, u.full_name AS reporter_name, u.uid AS reporter_uid, u.role AS reporter_role
      FROM fault_reports f
      JOIN users u ON u.id = f.reporter_user_id
    `;
    const rows =
      req.auth!.role === 'OPERATOR'
        ? db.prepare(`${baseQuery} ORDER BY f.id DESC LIMIT 100`).all()
        : db
            .prepare(`${baseQuery} WHERE f.reporter_user_id = ? ORDER BY f.id DESC LIMIT 50`)
            .all(req.auth!.userId);

    res.json({ reports: rows });
  });

  router.post('/', requireAuth, (req: AuthedRequest, res) => {
    const parsed = createFaultSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Vui lòng nhập tiêu đề và mô tả sự cố hợp lệ' });
      return;
    }

    const { slotId, title, description } = parsed.data;
    if (slotId) {
      const slotExists = db.prepare('SELECT id FROM slots WHERE id = ?').get(slotId);
      if (!slotExists) {
        res.status(404).json({ error: `Ô đỗ ${slotId} không tồn tại` });
        return;
      }
    }

    const now = new Date().toISOString();
    const result = db
      .prepare(
        `INSERT INTO fault_reports (reporter_user_id, slot_id, title, description, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'OPEN', ?, ?)`,
      )
      .run(req.auth!.userId, slotId ?? null, title, description, now, now);

    const report = db
      .prepare('SELECT * FROM fault_reports WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as unknown as FaultReportRow;

    wsHub.broadcast('FAULTS_UPDATED', { report });
    res.status(201).json({ report });
  });

  router.patch('/:id', requireAuth, requireRole('OPERATOR'), (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'ID báo cáo không hợp lệ' });
      return;
    }

    const parsed = updateFaultSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Trạng thái xử lý không hợp lệ' });
      return;
    }

    const existing = db.prepare('SELECT * FROM fault_reports WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Không tìm thấy phiếu báo cáo lỗi' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE fault_reports
       SET status = ?, operator_note = COALESCE(?, operator_note), updated_at = ?
       WHERE id = ?`,
    ).run(parsed.data.status, parsed.data.operatorNote ?? null, now, id);

    const updated = db.prepare('SELECT * FROM fault_reports WHERE id = ?').get(id);
    wsHub.broadcast('FAULTS_UPDATED', { report: updated });
    res.json({ report: updated });
  });

  return router;
}
