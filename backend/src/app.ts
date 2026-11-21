import http from 'http';
import express from 'express';
import cors from 'cors';
import { AppConfig, loadConfig } from './config';
import { initDatabase } from './db/database';
import { createAuthMiddleware } from './middleware/auth';
import { startMqttBroker } from './mqtt/broker';
import { createAuthRouter } from './routes/auth';
import { createFaultReportsRouter } from './routes/faultReports';
import { createGateRouter } from './routes/gate';
import { createOperatorRouter } from './routes/operator';
import { createOvernightRouter } from './routes/overnight';
import { createReservationsRouter } from './routes/reservations';
import { createSessionsRouter } from './routes/sessions';
import { createSettingsRouter } from './routes/settings';
import { createSlotsRouter } from './routes/slots';
import { GateService } from './services/gateService';
import { ParkingScheduler } from './services/scheduler';
import { SlotService } from './services/slotService';
import { WsHub } from './ws/hub';

export async function startParkingServer(overrides?: Partial<AppConfig>) {
  const config = loadConfig(overrides);
  const db = initDatabase(config);

  const app = express();
  app.use(cors());
  app.use(express.json());

  const httpServer = http.createServer(app);
  const wsHub = new WsHub(httpServer);
  const slotService = new SlotService(db, wsHub);
  const gateService = new GateService(db, wsHub);
  const scheduler = new ParkingScheduler(db, slotService, wsHub);
  const mqttBroker = await startMqttBroker(config.mqttPort, slotService, gateService);

  const requireAuth = createAuthMiddleware(db, config.jwtSecret);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      mqttPort: config.mqttPort,
      freeCount: slotService.getFreeCount(),
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/auth', createAuthRouter(db, config.jwtSecret, requireAuth));
  app.use('/api/slots', createSlotsRouter(slotService, requireAuth));
  app.use('/api/reservations', createReservationsRouter(db, slotService, wsHub, requireAuth));
  app.use('/api/overnight-requests', createOvernightRouter(db, slotService, wsHub, requireAuth));
  app.use('/api/gate', createGateRouter(db, gateService, slotService, wsHub, requireAuth));
  app.use('/api/sessions', createSessionsRouter(db, gateService, slotService, wsHub, requireAuth));
  app.use('/api/operator', createOperatorRouter(db, slotService, wsHub, requireAuth));
  app.use('/api/fault-reports', createFaultReportsRouter(db, wsHub, requireAuth));
  app.use('/api/settings', createSettingsRouter(db, scheduler, wsHub, requireAuth));

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[API] Unhandled error:', err);
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
  });

  slotService.recomputeAndSyncAll();
  scheduler.start(5000);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, '0.0.0.0', () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });

  return {
    config,
    db,
    app,
    httpServer,
    wsHub,
    slotService,
    gateService,
    scheduler,
    mqttBroker,
    async stop() {
      scheduler.stop();
      await mqttBroker.close();
      await wsHub.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      db.close();
    },
  };
}
