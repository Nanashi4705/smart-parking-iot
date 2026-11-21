import os from 'os';
import { startParkingServer } from './app';

function getLanIps(): string[] {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

async function main() {
  const server = await startParkingServer();
  const ips = getLanIps();

  console.log('====================================================');
  console.log('  SMART PARKING IoT BACKEND READY');
  console.log(`  HTTP & WS : http://localhost:${server.config.port}`);
  for (const ip of ips) {
    console.log(`  LAN Access: http://${ip}:${server.config.port}`);
  }
  console.log(`  MQTT Broker (Aedes): mqtt://0.0.0.0:${server.config.mqttPort}`);
  console.log(`  Gate QR Secret: ${server.config.gateQrSecret}`);
  console.log('  Demo accounts: admin/123456 (OPERATOR), user1/123456, user2/123456');
  console.log('====================================================');

  const shutdown = async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
