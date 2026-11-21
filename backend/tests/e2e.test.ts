import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mqtt from 'mqtt';
import WebSocket from 'ws';
import { startParkingServer } from '../src/app';

async function waitFor<T>(
  predicate: () => T | undefined | false | null | Promise<T | undefined | false | null>,
  timeoutMs = 4000,
  label = 'condition',
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = await predicate();
    if (val) return val;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function api<T>(
  baseUrl: string,
  endpoint: string,
  options: RequestInit & { token?: string } = {},
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const res = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers,
  });
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

async function runTests() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-parking-e2e-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const httpPort = 3456;
  const mqttPort = 11883;
  const baseUrl = `http://127.0.0.1:${httpPort}`;

  const server = await startParkingServer({
    port: httpPort,
    mqttPort,
    dbPath,
    jwtSecret: 'test-jwt-secret',
    gateQrSecret: 'TEST_GATE_SECRET',
  });

  const mqttMessages: Array<{ topic: string; payload: Record<string, unknown> }> = [];
  const wsEvents: Array<{ type: string; payload: unknown }> = [];

  const gwClient = mqtt.connect(`mqtt://127.0.0.1:${mqttPort}`, {
    clientId: 'esp32-gateway-test',
  });

  await new Promise<void>((resolve, reject) => {
    gwClient.once('connect', () => {
      gwClient.subscribe(
        ['parking/floor/+/cmd', 'parking/gate/cmd', 'parking/gate/display'],
        (err) => (err ? reject(err) : resolve()),
      );
    });
    gwClient.once('error', reject);
  });

  gwClient.on('message', (topic, message) => {
    try {
      mqttMessages.push({ topic, payload: JSON.parse(message.toString('utf8')) });
    } catch {
      // ignore
    }
  });

  const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.on('message', (raw) => {
    try {
      wsEvents.push(JSON.parse(raw.toString('utf8')));
    } catch {
      // ignore
    }
  });

  try {
    console.log('1. Test auth (login demo + register new user)...');
    const adminLogin = await api<{ token: string; user: { role: string; uid: string } }>(
      baseUrl,
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ username: 'admin', password: '123456' }) },
    );
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.data.user.role, 'OPERATOR');
    const opToken = adminLogin.data.token;

    const regRes = await api<{ token: string; user: { uid: string; walletBalance: number } }>(
      baseUrl,
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({
          username: 'driver99',
          password: 'password',
          fullName: 'Tài Xế Test',
          licensePlate: '29A-999.99',
        }),
      },
    );
    assert.equal(regRes.status, 201);
    assert.ok(regRes.data.user.uid.startsWith('UID-'));
    const userToken = regRes.data.token;

    console.log('2. Test reservation on F1-S1 turns LED ON (ledMode = 1)...');
    mqttMessages.length = 0;
    const reserveRes = await api<{ reservation: { id: number; slot_id: string } }>(
      baseUrl,
      '/api/reservations',
      { method: 'POST', token: userToken, body: JSON.stringify({ slotId: 'F1-S1' }) },
    );
    assert.equal(reserveRes.status, 201);
    const floor1LedCmd = await waitFor(
      () =>
        [...mqttMessages]
          .reverse()
          .find((m) => m.topic === 'parking/floor/1/cmd'),
      3000,
      'MQTT floor 1 led command for RESERVED',
    );
    const f1Slots = floor1LedCmd.payload.slots as Array<{ index: number; ledMode: number }>;
    assert.equal(f1Slots[0].ledMode, 1); // F1-S1 = RESERVED (LED ON)
    assert.equal(f1Slots[1].ledMode, 0); // F1-S2 = FREE (LED OFF)

    console.log('3. Test ultrasonic telemetry: normal OCCUPIED -> LED OFF (0), wrong parking on RESERVED -> LED BLINK (2)...');
    mqttMessages.length = 0;
    gwClient.publish(
      'parking/floor/1/telemetry',
      JSON.stringify({
        floor: 1,
        slots: [
          { index: 0, occupied: true, distanceCm: 5 },
          { index: 1, occupied: true, distanceCm: 6 },
        ],
      }),
    );
    const floor1OccCmd = await waitFor(
      () =>
        [...mqttMessages]
          .reverse()
          .find((m) => m.topic === 'parking/floor/1/cmd'),
      3000,
      'MQTT floor 1 led command for wrong parking + normal occupied',
    );
    const f1SlotsOcc = floor1OccCmd.payload.slots as Array<{ index: number; ledMode: number }>;
    assert.equal(f1SlotsOcc[0].ledMode, 2); // F1-S1 = RESERVED + car parked -> BLINK (2)
    assert.equal(f1SlotsOcc[1].ledMode, 0); // F1-S2 = OCCUPIED valid -> LED OFF (0)

    const slotsCheck = await api<{ slots: Array<{ id: string; wrongOccupancy: boolean }> }>(
      baseUrl,
      '/api/slots',
      { token: opToken },
    );
    assert.equal(slotsCheck.data.slots.find((s) => s.id === 'F1-S1')?.wrongOccupancy, true);

    // Clear both sensors -> F1-S1 returns to LED ON (1), F1-S2 stays LED OFF (0)
    mqttMessages.length = 0;
    gwClient.publish(
      'parking/floor/1/telemetry',
      JSON.stringify({
        floor: 1,
        slots: [
          { index: 0, occupied: false, distanceCm: 45 },
          { index: 1, occupied: false, distanceCm: 50 },
        ],
      }),
    );
    await waitFor(
      () =>
        mqttMessages.find(
          (m) =>
            m.topic === 'parking/floor/1/cmd' &&
            (m.payload.slots as Array<{ ledMode: number }>)[0].ledMode === 1 &&
            (m.payload.slots as Array<{ ledMode: number }>)[1].ledMode === 0,
        ),
      3000,
      'F1-S1 back to LED ON (1) and F1-S2 LED OFF (0)',
    );

    console.log('4. Test QR Check-in opens barrier and fulfills reservation...');
    mqttMessages.length = 0;
    const scanIn = await api<{ action: string; session: { id: number; slot_id: string } }>(
      baseUrl,
      '/api/gate/scan-qr',
      { method: 'POST', token: userToken, body: JSON.stringify({ qrCode: 'TEST_GATE_SECRET' }) },
    );
    assert.equal(scanIn.status, 200);
    assert.equal(scanIn.data.action, 'CHECK_IN');
    assert.equal(scanIn.data.session.slot_id, 'F1-S1');
    const sessionId = scanIn.data.session.id;

    const gateOpenCmd = await waitFor(
      () => mqttMessages.find((m) => m.topic === 'parking/gate/cmd'),
      3000,
      'MQTT gate open command on check-in',
    );
    assert.equal(gateOpenCmd.payload.action, 'OPEN_AUTO');

    console.log('5. Test Overtime penalty & LED BLINK (ledMode = 2)...');
    // Backdate check_in_time by 125 minutes with max_duration_minutes = 60
    await api(baseUrl, '/api/settings', {
      method: 'PUT',
      token: opToken,
      body: JSON.stringify({
        max_duration_minutes: 60,
        hourly_rate_vnd: 5000,
        penalty_flat_vnd: 50000,
        penalty_per_hour_vnd: 10000,
      }),
    });
    const oldCheckIn = new Date(Date.now() - 125 * 60000).toISOString();
    server.db
      .prepare('UPDATE parking_sessions SET check_in_time = ? WHERE id = ?')
      .run(oldCheckIn, sessionId);

    mqttMessages.length = 0;
    const tickResult = server.scheduler.runTick();
    assert.equal(tickResult.overtimeSessions, 1);

    const overtimeLedCmd = await waitFor(
      () =>
        mqttMessages.find(
          (m) =>
            m.topic === 'parking/floor/1/cmd' &&
            (m.payload.slots as Array<{ ledMode: number }>)[0].ledMode === 2,
        ),
      3000,
      'MQTT floor 1 ledMode 2 (OVERTIME BLINK)',
    );
    assert.ok(overtimeLedCmd);

    console.log('6. Verify overnight request is blocked AFTER overtime...');
    const lateOvernight = await api<{ error: string }>(
      baseUrl,
      '/api/overnight-requests',
      { method: 'POST', token: userToken, body: JSON.stringify({ reason: 'Xin qua dem muon' }) },
    );
    assert.equal(lateOvernight.status, 400);

    console.log('7. Test QR Check-out + Wallet Payment + Barrier Open...');
    const scanOut = await api<{
      action: string;
      feeBreakdown: { baseFee: number; penaltyFee: number; totalFee: number };
    }>(baseUrl, '/api/gate/scan-qr', {
      method: 'POST',
      token: userToken,
      body: JSON.stringify({ qrCode: 'TEST_GATE_SECRET' }),
    });
    assert.equal(scanOut.status, 200);
    assert.equal(scanOut.data.action, 'CHECK_OUT_PAYMENT_REQUIRED');
    // 125 min -> 3h base (15000), overtime 65m -> 2h overtime -> 50000 + 20000 = 70000, total = 85000
    assert.equal(scanOut.data.feeBreakdown.baseFee, 15000);
    assert.equal(scanOut.data.feeBreakdown.penaltyFee, 70000);
    assert.equal(scanOut.data.feeBreakdown.totalFee, 85000);

    mqttMessages.length = 0;
    const payRes = await api<{ success: boolean; walletBalance: number }>(
      baseUrl,
      `/api/sessions/${sessionId}/pay`,
      { method: 'POST', token: userToken, body: JSON.stringify({ paymentMethod: 'WALLET' }) },
    );
    assert.equal(payRes.status, 200);
    assert.equal(payRes.data.success, true);
    assert.equal(payRes.data.walletBalance, 200000 - 85000);

    const gateOutCmd = await waitFor(
      () => mqttMessages.find((m) => m.topic === 'parking/gate/cmd'),
      3000,
      'MQTT gate open command on payment',
    );
    assert.equal(gateOutCmd.payload.action, 'OPEN_AUTO');

    console.log('8. Test overnight request requires Operator approval (PENDING -> REJECTED / APPROVED)...');
    const user2Login = await api<{ token: string }>(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'user2', password: '123456' }),
    });
    const user2Token = user2Login.data.token;

    const overnightFirst = await api<{ request: { id: number; status: string } }>(
      baseUrl,
      '/api/overnight-requests',
      { method: 'POST', token: user2Token, body: JSON.stringify({ reason: 'Gui xe qua dem lan 1' }) },
    );
    assert.equal(overnightFirst.status, 201);
    assert.equal(overnightFirst.data.request.status, 'PENDING');

    const rejectRes = await api<{ request: { status: string; operator_note: string } }>(
      baseUrl,
      `/api/overnight-requests/${overnightFirst.data.request.id}/review`,
      {
        method: 'PATCH',
        token: opToken,
        body: JSON.stringify({ decision: 'REJECTED', operatorNote: 'Can ghi ro thoi gian nhan xe' }),
      },
    );
    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.data.request.status, 'REJECTED');
    assert.equal(rejectRes.data.request.operator_note, 'Can ghi ro thoi gian nhan xe');

    const overnightSecond = await api<{ request: { id: number; status: string } }>(
      baseUrl,
      '/api/overnight-requests',
      { method: 'POST', token: user2Token, body: JSON.stringify({ reason: 'Gui xe qua dem den 7h sang' }) },
    );
    assert.equal(overnightSecond.status, 201);
    assert.equal(overnightSecond.data.request.status, 'PENDING');

    // Check-in khi yeu cau van dang PENDING -> chua ap dung qua dem
    const u2In = await api<{ session: { id: number; has_overnight_request: number } }>(
      baseUrl,
      '/api/gate/scan-qr',
      { method: 'POST', token: user2Token, body: JSON.stringify({ qrCode: 'TEST_GATE_SECRET' }) },
    );
    assert.equal(u2In.data.session.has_overnight_request, 0);

    // Operator duyet yeu cau -> tu dong gan vao phien dang mo cua user2
    const approveRes = await api<{ request: { status: string; session_id: number } }>(
      baseUrl,
      `/api/overnight-requests/${overnightSecond.data.request.id}/review`,
      {
        method: 'PATCH',
        token: opToken,
        body: JSON.stringify({ decision: 'APPROVED', operatorNote: 'Dong y qua dem' }),
      },
    );
    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.data.request.status, 'APPROVED');
    assert.equal(approveRes.data.request.session_id, u2In.data.session.id);

    // Simulate 10 hours parked with approved overnight request -> no penalty, flat overnight fee 30,000
    server.db
      .prepare('UPDATE parking_sessions SET check_in_time = ? WHERE id = ?')
      .run(new Date(Date.now() - 600 * 60000).toISOString(), u2In.data.session.id);
    server.scheduler.runTick();

    const u2Out = await api<{
      feeBreakdown: { overnightFee: number; penaltyFee: number; totalFee: number };
    }>(baseUrl, '/api/gate/scan-qr', {
      method: 'POST',
      token: user2Token,
      body: JSON.stringify({ qrCode: 'TEST_GATE_SECRET' }),
    });
    assert.equal(u2Out.data.feeBreakdown.overnightFee, 30000);
    assert.equal(u2Out.data.feeBreakdown.penaltyFee, 0);
    assert.equal(u2Out.data.feeBreakdown.totalFee, 30000);

    console.log('9. Test Operator actions: assign slot, maintenance, manual fault report, RFID emergency log...');
    const assignRes = await api<{ session: { slot_id: string } }>(
      baseUrl,
      `/api/operator/sessions/${u2In.data.session.id}/assign-slot`,
      { method: 'POST', token: opToken, body: JSON.stringify({ slotId: 'F2-S1' }) },
    );
    assert.equal(assignRes.status, 200);
    assert.equal(assignRes.data.session.slot_id, 'F2-S1');

    const maintRes = await api<{ slots: Array<{ id: string; led_mode: number }> }>(
      baseUrl,
      '/api/operator/slots/F2-S2/maintenance',
      { method: 'PATCH', token: opToken, body: JSON.stringify({ maintenance: true }) },
    );
    assert.equal(maintRes.status, 200);
    assert.equal(maintRes.data.slots.find((s) => s.id === 'F2-S2')?.led_mode, 2);

    // RFID emergency event from Gate Node
    gwClient.publish(
      'parking/gate/event',
      JSON.stringify({
        eventType: 'RFID_EMERGENCY_OPEN',
        barrierOpen: true,
        carAtGate: false,
        gateDistanceCm: 42,
        rfidUid: 'DE AD BE EF',
      }),
    );

    const gateLogsAfterRfid = await waitFor(async () => {
      const logsRes = await api<{ logs: Array<{ event_type: string; rfid_uid: string }> }>(
        baseUrl,
        '/api/gate/logs',
        { token: opToken },
      );
      return logsRes.data.logs.find((l) => l.event_type === 'RFID_EMERGENCY_OPEN');
    }, 3000, 'RFID emergency log saved');
    assert.equal(gateLogsAfterRfid.rfid_uid, 'DE AD BE EF');

    // Manual fault report
    const faultCreate = await api<{ report: { id: number; status: string } }>(
      baseUrl,
      '/api/fault-reports',
      {
        method: 'POST',
        token: userToken,
        body: JSON.stringify({
          slotId: 'F2-S2',
          title: 'Đèn ô đỗ mờ',
          description: 'LED xanh sáng yếu cần kiểm tra điện trở',
        }),
      },
    );
    assert.equal(faultCreate.status, 201);
    const faultUpdate = await api<{ report: { status: string; operator_note: string } }>(
      baseUrl,
      `/api/fault-reports/${faultCreate.data.report.id}`,
      {
        method: 'PATCH',
        token: opToken,
        body: JSON.stringify({ status: 'RESOLVED', operatorNote: 'Đã thay LED mới' }),
      },
    );
    assert.equal(faultUpdate.status, 200);
    assert.equal(faultUpdate.data.report.status, 'RESOLVED');

    assert.ok(wsEvents.some((e) => e.type === 'SLOTS_UPDATED'));
    console.log('ALL BACKEND E2E TESTS PASSED!');
  } finally {
    ws.close();
    await new Promise<void>((resolve) => gwClient.end(true, () => resolve()));
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('E2E TEST FAILED:', err);
  process.exit(1);
});
