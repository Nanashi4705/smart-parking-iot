export type UserRole = 'USER' | 'OPERATOR';
export type SlotStatus = 'FREE' | 'RESERVED' | 'OCCUPIED' | 'OVERTIME' | 'MAINTENANCE';
export type ReservationStatus = 'ACTIVE' | 'FULFILLED' | 'CANCELLED' | 'EXPIRED';
export type SessionStatus = 'ACTIVE' | 'OVERTIME' | 'PENDING_PAYMENT' | 'COMPLETED';
export type OvernightStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED';
export type FaultStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

export interface User {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  uid: string;
  licensePlate: string;
  walletBalance: number;
  createdAt: string;
}

export interface Slot {
  id: string;
  floor: number;
  sensor_index: number;
  label: string;
  status: SlotStatus;
  sensor_occupied: number;
  distance_cm: number;
  led_mode: number;
  updated_at: string;
  reservedByUid: string | null;
  reservedExpiresAt: string | null;
  activeSessionId: number | null;
  activeSessionUid: string | null;
  activeSessionStatus: string | null;
  hasOvernightRequest: boolean;
  wrongOccupancy?: boolean;
}

export interface FeeBreakdown {
  durationMinutes: number;
  billableHours?: number;
  isOvertime: boolean;
  baseFee: number;
  overnightFee: number;
  penaltyFee: number;
  totalFee: number;
}

export interface ParkingSession {
  id: number;
  user_id: number;
  slot_id: string | null;
  reservation_id: number | null;
  check_in_time: string;
  check_out_time: string | null;
  status: SessionStatus;
  has_overnight_request: number;
  base_fee: number;
  overnight_fee: number;
  penalty_fee: number;
  total_fee: number;
  paid_at: string | null;
  payment_method: string | null;
  uid?: string;
  full_name?: string;
  license_plate?: string;
  liveFee?: FeeBreakdown;
}

export interface Reservation {
  id: number;
  user_id: number;
  slot_id: string;
  status: ReservationStatus;
  reserved_at: string;
  expires_at: string;
  note: string | null;
  uid?: string;
  full_name?: string;
  license_plate?: string;
}

export interface OvernightRequest {
  id: number;
  user_id: number;
  session_id: number | null;
  slot_id: string | null;
  reason: string;
  status: OvernightStatus;
  operator_note?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  uid?: string;
  full_name?: string;
  license_plate?: string;
}

export interface GateStatus {
  barrierState: 'CLOSED' | 'OPEN_AUTO' | 'OPEN_HOLD' | 'EMERGENCY_OPEN';
  carAtGate: boolean;
  gateDistanceCm: number;
  gateway: {
    online: boolean;
    ip: string | null;
    channel: number | null;
    lastSeen: string | null;
  };
  gateQrValue?: string;
}

export interface GateLog {
  id: number;
  event_type: string;
  actor_role: string;
  actor_uid: string | null;
  rfid_uid: string | null;
  detail: string | null;
  created_at: string;
}

export interface FaultReport {
  id: number;
  reporter_user_id: number;
  slot_id: string | null;
  title: string;
  description: string;
  status: FaultStatus;
  operator_note: string | null;
  created_at: string;
  updated_at: string;
  reporter_name?: string;
  reporter_uid?: string;
  reporter_role?: string;
}

export interface ParkingSettings {
  hourly_rate_vnd: number;
  overnight_fee_vnd: number;
  max_duration_minutes: number;
  penalty_flat_vnd: number;
  penalty_per_hour_vnd: number;
  reservation_hold_minutes: number;
  gate_qr_secret?: string;
}
