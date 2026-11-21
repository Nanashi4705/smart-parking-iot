import React, { useState } from 'react';
import {
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SlotGrid } from '../../components/SlotGrid';
import { StatusBadge } from '../../components/StatusBadge';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../context/AuthContext';
import { useParking } from '../../context/ParkingContext';
import { COLORS, formatDateTime, formatTime } from '../../theme';
import { OvernightRequest, ParkingSession, Reservation, Slot } from '../../types';

export function OperatorDashboardScreen() {
  const { serverUrl, token } = useAuth();
  const {
    slots,
    freeCount,
    totalCount,
    sessions,
    reservations,
    overnightRequests,
    faultReports,
    wsConnected,
    refreshing,
    refreshAll,
  } = useParking();

  const [assignTarget, setAssignTarget] = useState<
    | { kind: 'session'; item: ParkingSession }
    | { kind: 'reservation'; item: Reservation }
    | null
  >(null);

  const [reviewTarget, setReviewTarget] = useState<{
    req: OvernightRequest;
    decision: 'APPROVED' | 'REJECTED';
  } | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const openSessions = sessions.filter((s) => s.status !== 'COMPLETED');
  const overtimeCount = openSessions.filter((s) => s.status === 'OVERTIME').length;
  const activeReservations = reservations.filter((r) => r.status === 'ACTIVE');
  const pendingOvernights = overnightRequests.filter((r) => r.status === 'PENDING');
  const recentOvernights = overnightRequests.filter((r) => r.status !== 'PENDING').slice(0, 4);
  const openFaultsCount = faultReports.filter((f) => f.status !== 'RESOLVED').length;

  const handleToggleMaintenance = (slot: Slot) => {
    const nextMaint = slot.status !== 'MAINTENANCE';
    Alert.alert(
      nextMaint ? `Khóa bảo trì ${slot.id}?` : `Mở lại ô ${slot.id}?`,
      nextMaint
        ? 'Ô sẽ chuyển sang chế độ Bảo trì (LED nhấp nháy báo người kiểm tra).'
        : 'Ô sẽ được tính lại trạng thái theo cảm biến và lịch đặt.',
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xác nhận',
          onPress: async () => {
            try {
              await apiRequest(serverUrl, `/api/operator/slots/${slot.id}/maintenance`, {
                method: 'PATCH',
                token,
                body: JSON.stringify({ maintenance: nextMaint }),
              });
              await refreshAll();
            } catch (err) {
              Alert.alert('Lỗi', (err as Error).message);
            }
          },
        },
      ],
    );
  };

  const handleAssignSlot = async (slotId: string | null) => {
    if (!assignTarget) return;
    try {
      if (assignTarget.kind === 'session') {
        await apiRequest(
          serverUrl,
          `/api/operator/sessions/${assignTarget.item.id}/assign-slot`,
          {
            method: 'POST',
            token,
            body: JSON.stringify({ slotId }),
          },
        );
      } else if (slotId) {
        await apiRequest(
          serverUrl,
          `/api/operator/reservations/${assignTarget.item.id}/reassign-slot`,
          {
            method: 'POST',
            token,
            body: JSON.stringify({ slotId }),
          },
        );
      }
      setAssignTarget(null);
      await refreshAll();
    } catch (err) {
      Alert.alert('Không thể phân phối ô', (err as Error).message);
    }
  };

  const handleConfirmReview = async () => {
    if (!reviewTarget) return;
    try {
      await apiRequest(
        serverUrl,
        `/api/overnight-requests/${reviewTarget.req.id}/review`,
        {
          method: 'PATCH',
          token,
          body: JSON.stringify({
            decision: reviewTarget.decision,
            operatorNote: reviewNote.trim() || undefined,
          }),
        },
      );
      setReviewTarget(null);
      setReviewNote('');
      await refreshAll();
    } catch (err) {
      Alert.alert('Không thể xử lý yêu cầu', (err as Error).message);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Bảng điều hành bãi xe</Text>
          <Text style={styles.sub}>Chạm vào ô đỗ để bật/tắt bảo trì</Text>
        </View>
        <View style={[styles.wsPill, { backgroundColor: wsConnected ? COLORS.success : COLORS.warning }]}>
          <Text style={styles.wsText}>{wsConnected ? 'Realtime' : 'Reconnect'}</Text>
        </View>
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Trống</Text>
          <Text style={styles.statValue}>
            {freeCount}/{totalCount}
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Đang đỗ</Text>
          <Text style={[styles.statValue, { color: COLORS.primary }]}>{openSessions.length}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Quá giờ</Text>
          <Text style={[styles.statValue, { color: COLORS.danger }]}>{overtimeCount}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Qua đêm chờ</Text>
          <Text style={[styles.statValue, { color: COLORS.warning }]}>
            {pendingOvernights.length}
          </Text>
        </View>
      </View>

      <SlotGrid slots={slots} onSelectSlot={handleToggleMaintenance} />

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          Yêu cầu qua đêm chờ duyệt ({pendingOvernights.length})
        </Text>
        {pendingOvernights.length === 0 ? (
          <Text style={styles.empty}>Không có yêu cầu qua đêm nào đang chờ duyệt.</Text>
        ) : (
          pendingOvernights.map((req) => (
            <View key={req.id} style={styles.overnightCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.itemTitle}>
                  #{req.id} • {req.full_name || req.uid} ({req.license_plate || 'N/A'})
                </Text>
                <StatusBadge status={req.status} />
              </View>
              <Text style={styles.itemDesc}>Lý do: {req.reason}</Text>
              <Text style={styles.itemSub}>
                {req.session_id ? `Phiên #${req.session_id}` : 'Đăng ký trước khi vào cổng'} •{' '}
                {formatDateTime(req.created_at)}
              </Text>
              <View style={styles.reviewActionRow}>
                <TouchableOpacity
                  style={styles.rejectBtn}
                  onPress={() => {
                    setReviewNote('');
                    setReviewTarget({ req, decision: 'REJECTED' });
                  }}
                >
                  <Text style={styles.rejectBtnText}>Từ chối</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.approveBtn}
                  onPress={() => {
                    setReviewNote('');
                    setReviewTarget({ req, decision: 'APPROVED' });
                  }}
                >
                  <Text style={styles.approveBtnText}>Duyệt qua đêm</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        {recentOvernights.length > 0 && (
          <View style={styles.recentWrap}>
            <Text style={styles.recentTitle}>Đã xử lý gần đây</Text>
            {recentOvernights.map((req) => (
              <View key={req.id} style={styles.rowItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>
                    {req.full_name || req.uid} • {req.reason}
                  </Text>
                  {req.operator_note ? (
                    <Text style={styles.itemSub}>Ghi chú: {req.operator_note}</Text>
                  ) : null}
                </View>
                <StatusBadge status={req.status} />
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          Phiên đang gửi xe ({openSessions.length}) • Lỗi mở: {openFaultsCount}
        </Text>
        {openSessions.length === 0 ? (
          <Text style={styles.empty}>Hiện chưa có xe nào đang gửi.</Text>
        ) : (
          openSessions.map((s) => (
            <View key={s.id} style={styles.rowItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>
                  #{s.id} • {s.full_name || s.uid} ({s.license_plate || 'N/A'})
                </Text>
                <Text style={styles.itemSub}>
                  Vào {formatTime(s.check_in_time)} • Ô: {s.slot_id || 'Chưa phân phối'}
                  {s.has_overnight_request ? ' • Qua đêm' : ''}
                </Text>
              </View>
              <View style={styles.rightCol}>
                <StatusBadge status={s.status} />
                <TouchableOpacity
                  style={styles.assignBtn}
                  onPress={() => setAssignTarget({ kind: 'session', item: s })}
                >
                  <Text style={styles.assignBtnText}>Phân ô</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Lịch giữ chỗ đang hoạt động ({activeReservations.length})</Text>
        {activeReservations.length === 0 ? (
          <Text style={styles.empty}>Không có lịch giữ chỗ nào.</Text>
        ) : (
          activeReservations.map((r) => (
            <View key={r.id} style={styles.rowItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>
                  Ô {r.slot_id} • {r.full_name || r.uid}
                </Text>
                <Text style={styles.itemSub}>Giữ đến {formatTime(r.expires_at)}</Text>
              </View>
              <TouchableOpacity
                style={styles.assignBtn}
                onPress={() => setAssignTarget({ kind: 'reservation', item: r })}
              >
                <Text style={styles.assignBtnText}>Điều chỉnh ô</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      <Modal visible={assignTarget !== null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {assignTarget?.kind === 'session'
                ? `Phân phối ô cho phiên #${assignTarget.item.id}`
                : `Đổi ô cho lịch giữ chỗ #${assignTarget?.item.id}`}
            </Text>
            <View style={styles.slotOptionList}>
              {slots.map((slot) => (
                <TouchableOpacity
                  key={slot.id}
                  style={styles.slotOption}
                  onPress={() => handleAssignSlot(slot.id)}
                >
                  <Text style={styles.slotOptionId}>{slot.id}</Text>
                  <StatusBadge status={slot.status} />
                </TouchableOpacity>
              ))}
              {assignTarget?.kind === 'session' && (
                <TouchableOpacity
                  style={[styles.slotOption, { backgroundColor: '#F1F5F9' }]}
                  onPress={() => handleAssignSlot(null)}
                >
                  <Text style={styles.slotOptionId}>Bỏ gắn ô (null)</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity style={styles.modalClose} onPress={() => setAssignTarget(null)}>
              <Text style={styles.modalCloseText}>Đóng</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={reviewTarget !== null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {reviewTarget?.decision === 'APPROVED'
                ? `Duyệt yêu cầu qua đêm #${reviewTarget?.req.id}?`
                : `Từ chối yêu cầu qua đêm #${reviewTarget?.req.id}?`}
            </Text>
            <Text style={styles.itemDesc}>
              {reviewTarget?.req.full_name || reviewTarget?.req.uid}: {reviewTarget?.req.reason}
            </Text>
            <TextInput
              style={styles.input}
              value={reviewNote}
              onChangeText={setReviewNote}
              placeholder="Ghi chú cho người dùng (tùy chọn)"
            />
            <View style={styles.reviewActionRow}>
              <TouchableOpacity
                style={styles.cancelModalBtn}
                onPress={() => setReviewTarget(null)}
              >
                <Text style={styles.cancelModalText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmReviewBtn,
                  {
                    backgroundColor:
                      reviewTarget?.decision === 'APPROVED' ? COLORS.success : COLORS.danger,
                  },
                ]}
                onPress={handleConfirmReview}
              >
                <Text style={styles.approveBtnText}>
                  {reviewTarget?.decision === 'APPROVED' ? 'Xác nhận Duyệt' : 'Xác nhận Từ chối'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, gap: 14, paddingBottom: 28 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.dark },
  sub: { fontSize: 12, color: COLORS.muted },
  wsPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  wsText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  statsGrid: { flexDirection: 'row', gap: 8 },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  statLabel: { fontSize: 11, color: COLORS.muted, fontWeight: '700' },
  statValue: { fontSize: 18, fontWeight: '900', color: COLORS.dark, marginTop: 2 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: COLORS.dark },
  empty: { fontSize: 13, color: COLORS.muted },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  overnightCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    gap: 6,
  },
  recentWrap: { marginTop: 4, gap: 8 },
  recentTitle: { fontSize: 12, fontWeight: '700', color: COLORS.muted },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  itemTitle: { fontSize: 14, fontWeight: '700', color: COLORS.dark, flexShrink: 1 },
  itemDesc: { fontSize: 13, color: COLORS.dark },
  itemSub: { fontSize: 12, color: COLORS.muted },
  reviewActionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  rejectBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: COLORS.dangerSoft,
    alignItems: 'center',
  },
  rejectBtnText: { color: COLORS.danger, fontWeight: '800', fontSize: 13 },
  approveBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: COLORS.success,
    alignItems: 'center',
  },
  approveBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  rightCol: { alignItems: 'flex-end', gap: 6 },
  assignBtn: {
    backgroundColor: COLORS.primarySoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  assignBtnText: { color: COLORS.primary, fontWeight: '800', fontSize: 12 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 18,
    gap: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: COLORS.dark },
  input: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  cancelModalBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
  },
  cancelModalText: { fontWeight: '700', color: COLORS.dark },
  confirmReviewBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  slotOptionList: { gap: 8 },
  slotOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  slotOptionId: { fontSize: 15, fontWeight: '800', color: COLORS.dark },
  modalClose: {
    backgroundColor: COLORS.dark,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalCloseText: { color: '#FFF', fontWeight: '800' },
});
