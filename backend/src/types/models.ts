export type UserRole = 'USER' | 'OPERATOR';

export type SlotStatus = 'FREE' | 'RESERVED' | 'OCCUPIED' | 'OVERTIME' | 'MAINTENANCE';

export type LedMode = 0 | 1 | 2;
// 0: OFF (Không sao / bình thường: Trống hoặc Đang đỗ hợp lệ)
// 1: ON (Đã đặt lịch trước, đang giữ chỗ)
// 2: BLINK (Sai / cần kiểm tra: Quá giờ, Đỗ nhầm vào ô đặt trước, hoặc Bảo trì)

export type ReservationStatus = 'ACTIVE' | 'FULFILLED' | 'CANCELLED' | 'EXPIRED';
export type SessionStatus = 'ACTIVE' | 'OVERTIME' | 'PENDING_PAYMENT' | 'COMPLETED';
export type OvernightStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED';
export type FaultStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  uid: string;
  license_plate: string;
  wallet_balance: number;
  created_at: string;
}

export interface PublicUser {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  uid: string;
  licensePlate: string;
  walletBalance: number;
  createdAt: string;
}

export interface SlotRow {
  id: string;
  floor: number;
  sensor_index: number;
  label: string;
  status: SlotStatus;
  sensor_occupied: number;
  distance_cm: number;
  led_mode: LedMode;
  updated_at: string;
}

export interface ReservationRow {
  id: number;
  user_id: number;
  slot_id: string;
  status: ReservationStatus;
  reserved_at: string;
  expires_at: string;
  note: string | null;
}

export interface ParkingSessionRow {
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
}

export interface OvernightRequestRow {
  id: number;
  user_id: number;
  session_id: number | null;
  slot_id: string | null;
  reason: string;
  status: OvernightStatus;
  operator_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface GateLogRow {
  id: number;
  event_type: string;
  actor_role: string;
  actor_uid: string | null;
  rfid_uid: string | null;
  detail: string | null;
  created_at: string;
}

export interface FaultReportRow {
  id: number;
  reporter_user_id: number;
  slot_id: string | null;
  title: string;
  description: string;
  status: FaultStatus;
  operator_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParkingSettings {
  hourly_rate_vnd: number;
  overnight_fee_vnd: number;
  max_duration_minutes: number;
  penalty_flat_vnd: number;
  penalty_per_hour_vnd: number;
  reservation_hold_minutes: number;
  gate_qr_secret: string;
}
