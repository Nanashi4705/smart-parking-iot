import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme';

const STATUS_MAP: Record<string, { label: string; bg: string; color: string }> = {
  FREE: { label: 'Trống', bg: '#F1F5F9', color: COLORS.muted },
  RESERVED: { label: 'Đã đặt lịch', bg: COLORS.dangerSoft, color: COLORS.danger },
  OCCUPIED: { label: 'Đang đỗ', bg: COLORS.successSoft, color: COLORS.success },
  OVERTIME: { label: 'Quá giờ phạt', bg: COLORS.danger, color: '#FFFFFF' },
  MAINTENANCE: { label: 'Bảo trì', bg: COLORS.purpleSoft, color: COLORS.purple },
  ACTIVE: { label: 'Đang hoạt động', bg: COLORS.primarySoft, color: COLORS.primary },
  PENDING_PAYMENT: { label: 'Chờ thanh toán', bg: COLORS.warningSoft, color: COLORS.warning },
  COMPLETED: { label: 'Hoàn tất', bg: COLORS.successSoft, color: COLORS.success },
  FULFILLED: { label: 'Đã nhận chỗ', bg: COLORS.successSoft, color: COLORS.success },
  CANCELLED: { label: 'Đã hủy', bg: '#F1F5F9', color: COLORS.muted },
  EXPIRED: { label: 'Hết hạn', bg: COLORS.warningSoft, color: COLORS.warning },
  PENDING: { label: 'Chờ duyệt', bg: COLORS.warningSoft, color: COLORS.warning },
  APPROVED: { label: 'Đã duyệt', bg: COLORS.successSoft, color: COLORS.success },
  REJECTED: { label: 'Từ chối', bg: COLORS.dangerSoft, color: COLORS.danger },
  OPEN: { label: 'Mới tiếp nhận', bg: COLORS.dangerSoft, color: COLORS.danger },
  IN_PROGRESS: { label: 'Đang xử lý', bg: COLORS.warningSoft, color: COLORS.warning },
  RESOLVED: { label: 'Đã xử lý', bg: COLORS.successSoft, color: COLORS.success },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_MAP[status] ?? { label: status, bg: '#E2E8F0', color: COLORS.dark };
  return (
    <View style={[styles.badge, { backgroundColor: meta.bg }]}>
      <Text style={[styles.text, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
  },
});
