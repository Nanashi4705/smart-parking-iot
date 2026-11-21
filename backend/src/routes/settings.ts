import { Router } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { getSettings } from '../db/database';
import { AuthedRequest, requireRole } from '../middleware/auth';
import { ParkingScheduler } from '../services/scheduler';
import { WsHub } from '../ws/hub';

const updateSettingsSchema = z.object({
  hourly_rate_vnd: z.number().int().min(0).max(1000000).optional(),
  overnight_fee_vnd: z.number().int().min(0).max(2000000).optional(),
  max_duration_minutes: z.number().int().min(1).max(10080).optional(),
  penalty_flat_vnd: z.number().int().min(0).max(5000000).optional(),
  penalty_per_hour_vnd: z.number().int().min(0).max(1000000).optional(),
  reservation_hold_minutes: z.number().int().min(1).max(1440).optional(),
});

export function createSettingsRouter(
  db: DatabaseSync,
  scheduler: ParkingScheduler,
  wsHub: WsHub,
  requireAuth: ReturnType<typeof import('../middleware/auth').createAuthMiddleware>,
) {
  const router = Router();

  router.get('/', requireAuth, (req: AuthedRequest, res) => {
    const settings = getSettings(db);
    if (req.auth!.role === 'OPERATOR') {
      res.json({ settings });
      return;
    }
    const { gate_qr_secret: _hidden, ...publicSettings } = settings;
    res.json({ settings: publicSettings });
  });

  router.put('/', requireAuth, requireRole('OPERATOR'), (req, res) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Giá trị cấu hình không hợp lệ', details: parsed.error.flatten() });
      return;
    }

    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) {
        upsert.run(key, String(value));
      }
    }

    scheduler.runTick();
    const updated = getSettings(db);
    const { gate_qr_secret: _hidden, ...publicSettings } = updated;
    wsHub.broadcast('SETTINGS_UPDATED', { settings: publicSettings });

    res.json({ settings: updated });
  });

  return router;
}
