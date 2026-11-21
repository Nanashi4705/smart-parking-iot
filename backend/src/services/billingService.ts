import { ParkingSessionRow, ParkingSettings } from '../types/models';

export interface FeeBreakdown {
  durationMinutes: number;
  billableHours: number;
  isOvertime: boolean;
  baseFee: number;
  overnightFee: number;
  penaltyFee: number;
  totalFee: number;
}

export function calculateSessionFee(
  session: Pick<ParkingSessionRow, 'check_in_time' | 'status' | 'has_overnight_request'>,
  settings: ParkingSettings,
  now: Date = new Date(),
): FeeBreakdown {
  const checkInMs = new Date(session.check_in_time).getTime();
  const elapsedMs = Math.max(0, now.getTime() - checkInMs);
  const durationMinutes = Math.max(1, Math.ceil(elapsedMs / 60000));
  const billableHours = Math.max(1, Math.ceil(durationMinutes / 60));

  if (session.has_overnight_request === 1) {
    return {
      durationMinutes,
      billableHours,
      isOvertime: false,
      baseFee: 0,
      overnightFee: settings.overnight_fee_vnd,
      penaltyFee: 0,
      totalFee: settings.overnight_fee_vnd,
    };
  }

  const exceeded = durationMinutes > settings.max_duration_minutes;
  const isOvertime = session.status === 'OVERTIME' || exceeded;
  const baseFee = billableHours * settings.hourly_rate_vnd;

  let penaltyFee = 0;
  if (isOvertime) {
    const overtimeMinutes = Math.max(1, durationMinutes - settings.max_duration_minutes);
    const overtimeHours = Math.max(1, Math.ceil(overtimeMinutes / 60));
    penaltyFee = settings.penalty_flat_vnd + overtimeHours * settings.penalty_per_hour_vnd;
  }

  return {
    durationMinutes,
    billableHours,
    isOvertime,
    baseFee,
    overnightFee: 0,
    penaltyFee,
    totalFee: baseFee + penaltyFee,
  };
}
