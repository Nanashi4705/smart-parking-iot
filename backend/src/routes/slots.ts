import { Router } from 'express';
import { SlotService } from '../services/slotService';

export function createSlotsRouter(
  slotService: SlotService,
  requireAuth: ReturnType<typeof import('../middleware/auth').createAuthMiddleware>,
) {
  const router = Router();

  router.get('/', requireAuth, (_req, res) => {
    const slots = slotService.getAllSlots();
    const freeCount = slots.filter((s) => s.status === 'FREE').length;
    res.json({
      slots,
      freeCount,
      totalCount: slots.length,
    });
  });

  return router;
}
