import { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';

export interface WsEvent {
  type: string;
  payload: unknown;
  timestamp: string;
}

export class WsHub {
  private wss: WebSocketServer;

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      ws.send(
        JSON.stringify({
          type: 'CONNECTED',
          payload: { message: 'Connected to Smart Parking WebSocket' },
          timestamp: new Date().toISOString(),
        }),
      );
    });
  }

  broadcast(type: string, payload: unknown): void {
    const message: WsEvent = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    const raw = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of this.wss.clients) {
        client.terminate();
      }
      this.wss.close(() => resolve());
    });
  }
}
