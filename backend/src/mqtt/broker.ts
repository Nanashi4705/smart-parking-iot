import net from 'net';
import { Aedes } from 'aedes';
import { LedMode } from '../types/models';
import { GateService } from '../services/gateService';
import { MqttPublisherBridge, SlotService } from '../services/slotService';

export interface MqttBrokerHandle extends MqttPublisherBridge {
  port: number;
  close(): Promise<void>;
}

export async function startMqttBroker(
  port: number,
  slotService: SlotService,
  gateService: GateService,
): Promise<MqttBrokerHandle> {
  const broker = await Aedes.createBroker();
  const tcpServer = net.createServer(broker.handle);

  const publishJson = (topic: string, payload: unknown, retain = false) => {
    const msg = JSON.stringify(payload);
    broker.publish(
      {
        cmd: 'publish',
        qos: 0,
        dup: false,
        retain,
        topic,
        payload: Buffer.from(msg),
      },
      (err) => {
        if (err) {
          console.error(`[MQTT] Publish error on ${topic}:`, err);
        }
      },
    );
  };

  broker.on('clientReady', (client) => {
    console.log(`[MQTT] Client connected: ${client.id}`);
    if (client.id.toLowerCase().includes('gateway')) {
      gateService.updateGatewayStatus({ online: true });
      slotService.syncHardware();
    }
  });

  broker.on('clientDisconnect', (client) => {
    console.log(`[MQTT] Client disconnected: ${client.id}`);
    if (client.id.toLowerCase().includes('gateway')) {
      gateService.updateGatewayStatus({ online: false });
    }
  });

  broker.on('publish', (packet, client) => {
    if (!client) return; // Bo qua message do chinh broker publish
    if (packet.topic.startsWith('$SYS/')) return;

    const raw = packet.payload.toString('utf8');
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.warn(`[MQTT] Invalid JSON on ${packet.topic}:`, raw);
      return;
    }

    try {
      if (packet.topic === 'parking/gateway/status') {
        gateService.updateGatewayStatus({
          online: Boolean(data.online ?? true),
          ip: typeof data.ip === 'string' ? data.ip : undefined,
          channel: typeof data.channel === 'number' ? data.channel : undefined,
        });
        slotService.syncHardware();
      } else if (
        packet.topic === 'parking/floor/1/telemetry' ||
        packet.topic === 'parking/floor/2/telemetry'
      ) {
        const floor = packet.topic.includes('/1/') ? 1 : 2;
        const slots = Array.isArray(data.slots)
          ? data.slots.map((item: Record<string, unknown>) => ({
              index: Number(item.index ?? 0),
              occupied: Boolean(item.occupied),
              distanceCm: Number(item.distanceCm ?? 999),
            }))
          : [];
        if (slots.length > 0) {
          slotService.handleFloorTelemetry(floor, slots);
        }
      } else if (packet.topic === 'parking/gate/event') {
        gateService.handleGateEvent({
          eventType: String(data.eventType ?? 'UNKNOWN'),
          barrierOpen: typeof data.barrierOpen === 'boolean' ? data.barrierOpen : undefined,
          carAtGate: typeof data.carAtGate === 'boolean' ? data.carAtGate : undefined,
          gateDistanceCm: typeof data.gateDistanceCm === 'number' ? data.gateDistanceCm : undefined,
          rfidUid: typeof data.rfidUid === 'string' ? data.rfidUid : undefined,
        });
      }
    } catch (err) {
      console.error(`[MQTT] Error handling topic ${packet.topic}:`, err);
    }
  });

  await new Promise<void>((resolve, reject) => {
    tcpServer.once('error', reject);
    tcpServer.listen(port, '0.0.0.0', () => {
      tcpServer.removeListener('error', reject);
      resolve();
    });
  });

  const bridge: MqttBrokerHandle = {
    port,
    publishFloorLedCommand(floor: number, ledModes: [LedMode, LedMode]): void {
      publishJson(`parking/floor/${floor}/cmd`, {
        floor,
        slots: [
          { index: 0, ledMode: ledModes[0] },
          { index: 1, ledMode: ledModes[1] },
        ],
      });
    },
    publishGateCommand(
      action: 'CLOSE' | 'OPEN_AUTO' | 'OPEN_HOLD',
      reason: string,
      displayLine: string,
    ): void {
      publishJson('parking/gate/cmd', {
        action,
        reason,
        displayLine,
      });
    },
    publishGateDisplay(
      freeCount: number,
      totalCount: number,
      slotModes: number[],
      statusText: string,
    ): void {
      publishJson('parking/gate/display', {
        freeCount,
        totalCount,
        slotModes,
        statusText,
      });
    },
    close(): Promise<void> {
      return new Promise((resolve) => {
        broker.close(() => {
          tcpServer.close(() => resolve());
        });
      });
    },
  };

  slotService.attachMqttBridge(bridge);
  gateService.attachMqttBridge(bridge);

  return bridge;
}
