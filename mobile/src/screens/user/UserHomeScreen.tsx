import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import React, { useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SlotGrid } from '../../components/SlotGrid';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useParking } from '../../context/ParkingContext';
import { COLORS, formatTime, formatVnd } from '../../theme';

export function UserHomeScreen({
  navigation,
}: {
  navigation: BottomTabNavigationProp<Record<string, undefined>>;
}) {
  const { user } = useAuth();
  const {
    slots,
    freeCount,
    totalCount,
    activeSession,
    reservations,
    settings,
    wsConnected,
    refreshing,
    refreshAll,
  } = useParking();

  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  const activeReservation = reservations.find((r) => r.status === 'ACTIVE');
  const elapsedMinutes = activeSession
    ? Math.max(
        1,
        Math.ceil((nowTick - new Date(activeSession.check_in_time).getTime()) / 60000),
      )
    : 0;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Xin chào, {user?.fullName}</Text>
          <Text style={styles.uidLine}>
            {user?.uid} • Biển số: {user?.licensePlate || 'Chưa cập nhật'}
          </Text>
        </View>
        <View style={[styles.wsDot, { backgroundColor: wsConnected ? COLORS.success : COLORS.warning }]}>
          <Text style={styles.wsText}>{wsConnected ? 'Live' : 'Kết nối lại'}</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Vị trí còn trống</Text>
          <Text style={styles.statValue}>
            {freeCount} / {totalCount}
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Số dư ví</Text>
          <Text style={[styles.statValue, { color: COLORS.primary }]}>
            {formatVnd(user?.walletBalance ?? 0)}
          </Text>
        </View>
      </View>

      {activeSession && (
        <View
          style={[
            styles.sessionCard,
            activeSession.status === 'OVERTIME' && styles.sessionOvertime,
          ]}
        >
          <View style={styles.sessionTop}>
            <Text style={styles.sessionTitle}>Phiên đang gửi xe #{activeSession.id}</Text>
            <StatusBadge status={activeSession.status} />
          </View>
          <Text style={styles.sessionMeta}>
            Vào cổng lúc: {formatTime(activeSession.check_in_time)} • Đã gửi: {elapsedMinutes} phút
          </Text>
          <Text style={styles.sessionMeta}>
            Vị trí: {activeSession.slot_id || 'Chưa gắn ô'} • Qua đêm:{' '}
            {activeSession.has_overnight_request ? 'Đã đăng ký' : 'Chưa'}
          </Text>
          {activeSession.liveFee && (
            <Text style={styles.feePreview}>
              Tạm tính: {formatVnd(activeSession.liveFee.totalFee)}
              {activeSession.liveFee.penaltyFee > 0
                ? ` (Gồm phạt ${formatVnd(activeSession.liveFee.penaltyFee)})`
                : ''}
            </Text>
          )}

          {activeSession.status === 'OVERTIME' && (
            <Text style={styles.overtimeWarn}>
              Cảnh báo: Bạn đã đỗ quá {settings?.max_duration_minutes ?? 240} phút mà chưa tạo yêu
              cầu qua đêm từ trước. Hệ thống đã áp dụng phí phạt!
            </Text>
          )}

          <View style={styles.sessionActions}>
            {activeSession.status === 'ACTIVE' && !activeSession.has_overnight_request && (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => navigation.navigate('Requests')}
              >
                <Text style={styles.secondaryBtnText}>Đăng ký qua đêm</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.primarySmallBtn}
              onPress={() => navigation.navigate('Scan')}
            >
              <Text style={styles.primarySmallBtnText}>
                {activeSession.status === 'PENDING_PAYMENT' ? 'Thanh toán ngay' : 'Quét QR ra cổng'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {activeReservation && !activeSession && (
        <View style={styles.reserveCard}>
          <View style={styles.sessionTop}>
            <Text style={styles.reserveTitle}>Đang giữ chỗ ô {activeReservation.slot_id}</Text>
            <StatusBadge status="RESERVED" />
          </View>
          <Text style={styles.sessionMeta}>
            Hiệu lực đến: {formatTime(activeReservation.expires_at)} • Đèn đỏ đang bật tại ô này
          </Text>
          <TouchableOpacity
            style={styles.primarySmallBtn}
            onPress={() => navigation.navigate('Scan')}
          >
            <Text style={styles.primarySmallBtnText}>Quét QR vào cổng</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Sơ đồ bãi xe trực tuyến</Text>
        <Text style={styles.sectionSub}>
          Đơn giá: {formatVnd(settings?.hourly_rate_vnd ?? 5000)}/giờ
        </Text>
      </View>

      <SlotGrid slots={slots} />

      <View style={styles.legendCard}>
        <Text style={styles.legendTitle}>Quy ước 1 đèn LED tại mỗi ô đỗ</Text>
        <Text style={styles.legendLine}>• Đèn Tắt: Bình thường (Ô trống hoặc đang đỗ hợp lệ)</Text>
        <Text style={styles.legendLine}>• Đèn Sáng cố định: Đã đặt lịch giữ chỗ trước</Text>
        <Text style={styles.legendLine}>
          • Đèn Nhấp nháy: Quá giờ, đỗ nhầm ô đặt trước, hoặc bảo trì (báo kiểm tra)
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  content: {
    padding: 16,
    gap: 14,
    paddingBottom: 28,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.dark,
  },
  uidLine: {
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 2,
  },
  wsDot: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  wsText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.muted,
    fontWeight: '600',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.dark,
    marginTop: 4,
  },
  sessionCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    gap: 6,
  },
  sessionOvertime: {
    borderColor: COLORS.danger,
    backgroundColor: '#FFF5F5',
  },
  sessionTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.dark,
  },
  sessionMeta: {
    fontSize: 13,
    color: COLORS.muted,
  },
  feePreview: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.primary,
    marginTop: 2,
  },
  overtimeWarn: {
    fontSize: 12,
    color: COLORS.danger,
    fontWeight: '700',
    marginTop: 2,
  },
  sessionActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.warningSoft,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: COLORS.warning,
    fontWeight: '800',
    fontSize: 13,
  },
  primarySmallBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  primarySmallBtnText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 13,
  },
  reserveCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: COLORS.danger,
    gap: 8,
  },
  reserveTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.dark,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.dark,
  },
  sectionSub: {
    fontSize: 12,
    color: COLORS.muted,
    fontWeight: '600',
  },
  legendCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
  },
  legendTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.dark,
    marginBottom: 4,
  },
  legendLine: {
    fontSize: 12,
    color: COLORS.muted,
  },
});
