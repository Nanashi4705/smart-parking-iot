import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiRequest, buildWsUrl } from '../config/api';
import {
  FaultReport,
  GateLog,
  GateStatus,
  OvernightRequest,
  ParkingSession,
  ParkingSettings,
  Reservation,
  Slot,
} from '../types';
import { useAuth } from './AuthContext';

interface ParkingContextValue {
  slots: Slot[];
  freeCount: number;
  totalCount: number;
  gateStatus: GateStatus | null;
  gateLogs: GateLog[];
  activeSession: ParkingSession | null;
  sessions: ParkingSession[];
  reservations: Reservation[];
  overnightRequests: OvernightRequest[];
  faultReports: FaultReport[];
  settings: ParkingSettings | null;
  wsConnected: boolean;
  refreshing: boolean;
  refreshAll: () => Promise<void>;
}

const ParkingContext = createContext<ParkingContextValue | undefined>(undefined);

export function ParkingProvider({ children }: { children: React.ReactNode }) {
  const { serverUrl, token, user } = useAuth();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [freeCount, setFreeCount] = useState(0);
  const [totalCount, setTotalCount] = useState(4);
  const [gateStatus, setGateStatus] = useState<GateStatus | null>(null);
  const [gateLogs, setGateLogs] = useState<GateLog[]>([]);
  const [activeSession, setActiveSession] = useState<ParkingSession | null>(null);
  const [sessions, setSessions] = useState<ParkingSession[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [overnightRequests, setOvernightRequests] = useState<OvernightRequest[]>([]);
  const [faultReports, setFaultReports] = useState<FaultReport[]>([]);
  const [settings, setSettings] = useState<ParkingSettings | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const refreshAll = useCallback(async () => {
    if (!token || !user) return;
    setRefreshing(true);
    try {
      const [
        slotsRes,
        gateRes,
        logsRes,
        sessionsRes,
        activeSesRes,
        reservationsRes,
        overnightRes,
        faultsRes,
        settingsRes,
      ] = await Promise.all([
        apiRequest<{ slots: Slot[]; freeCount: number; totalCount: number }>(
          serverUrl,
          '/api/slots',
          { token },
        ),
        apiRequest<GateStatus>(serverUrl, '/api/gate/status', { token }),
        apiRequest<{ logs: GateLog[] }>(serverUrl, '/api/gate/logs?limit=40', { token }),
        apiRequest<{ sessions: ParkingSession[] }>(serverUrl, '/api/sessions', { token }),
        apiRequest<{ session: ParkingSession | null; liveFee: ParkingSession['liveFee'] | null }>(
          serverUrl,
          '/api/sessions/active',
          { token },
        ),
        apiRequest<{ reservations: Reservation[] }>(serverUrl, '/api/reservations', { token }),
        apiRequest<{ requests: OvernightRequest[] }>(serverUrl, '/api/overnight-requests', { token }),
        apiRequest<{ reports: FaultReport[] }>(serverUrl, '/api/fault-reports', { token }),
        apiRequest<{ settings: ParkingSettings }>(serverUrl, '/api/settings', { token }),
      ]);

      setSlots(slotsRes.slots);
      setFreeCount(slotsRes.freeCount);
      setTotalCount(slotsRes.totalCount);
      setGateStatus(gateRes);
      setGateLogs(logsRes.logs);
      setSessions(sessionsRes.sessions);
      setActiveSession(
        activeSesRes.session
          ? { ...activeSesRes.session, liveFee: activeSesRes.liveFee ?? undefined }
          : null,
      );
      setReservations(reservationsRes.reservations);
      setOvernightRequests(overnightRes.requests);
      setFaultReports(faultsRes.reports);
      setSettings(settingsRes.settings);
    } catch {
      // Ignore transient poll errors
    } finally {
      setRefreshing(false);
    }
  }, [serverUrl, token, user]);

  useEffect(() => {
    if (!token || !user) return;
    refreshAll();
  }, [token, user, refreshAll]);

  useEffect(() => {
    if (!token || !user) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      return;
    }

    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(buildWsUrl(serverUrl));
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as { type: string };
          if (parsed.type !== 'CONNECTED') {
            refreshAll();
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [serverUrl, token, user, refreshAll]);

  return (
    <ParkingContext.Provider
      value={{
        slots,
        freeCount,
        totalCount,
        gateStatus,
        gateLogs,
        activeSession,
        sessions,
        reservations,
        overnightRequests,
        faultReports,
        settings,
        wsConnected,
        refreshing,
        refreshAll,
      }}
    >
      {children}
    </ParkingContext.Provider>
  );
}

export function useParking() {
  const ctx = useContext(ParkingContext);
  if (!ctx) throw new Error('useParking must be used inside ParkingProvider');
  return ctx;
}
