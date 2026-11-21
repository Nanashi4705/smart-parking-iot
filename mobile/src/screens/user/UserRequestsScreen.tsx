import React, { useState } from 'react';
import {
  Alert,
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
import { COLORS, formatDateTime, formatVnd } from '../../theme';

export function UserRequestsScreen() {
  const { serverUrl, token } = useAuth();
  const {
    slots,
    reservations,
    overnightRequests,
    settings,
    refreshing,
    refreshAll,
  } = useParking();

  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [reserveNote, setReserveNote] = useState('');
  const [overnightReason, setOvernightReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleReserve = async () => {
    if (!selectedSlotId) {
      Alert.alert('Chưa chọn ô', 'Vui lòng chạm vào một ô Trống ở sơ đồ bên trên');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest(serverUrl, '/api/reservations', {
        method: 'POST',
        token,
        body: JSON.stringify({ slotId: selectedSlotId, note: reserveNote.trim() || undefined }),
      });
      setSelectedSlotId(null);
      setReserveNote('');
      await refreshAll();
      Alert.alert('Thành công', `Đã giữ chỗ ô ${selectedSlotId}. Đèn đỏ tại ô này đã được bật!`);
    } catch (err) {
      Alert.alert('Không thể đặt lịch', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelReservation = async (id: number) => {
    try {
      await apiRequest(serverUrl, `/api/reservations/${id}`, {
        method: 'DELETE',
        token,
      });
      await refreshAll();
    } catch (err) {
      Alert.alert('Lỗi', (err as Error).message);
    }
  };

  const handleOvernight = async () => {
    if (overnightReason.trim().length < 2) {
      Alert.alert('Thiếu lý do', 'Vui lòng nhập lý do để xe qua đêm');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest(serverUrl, '/api/overnight-requests', {
        method: 'POST',
        token,
        body: JSON.stringify({ reason: overnightReason.trim() }),
      });
      setOvernightReason('');
      await refreshAll();
      Alert.alert('Đã gửi yêu cầu', 'Yêu cầu để xe qua đêm đang chờ Người điều hành duyệt.');
    } catch (err) {
      Alert.alert('Không thể tạo yêu cầu', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelOvernight = async (id: number) => {
    try {
      await apiRequest(serverUrl, `/api/overnight-requests/${id}`, {
        method: 'DELETE',
        token,
      });
      await refreshAll();
    } catch (err) {
      Alert.alert('Lỗi', (err as Error).message);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} />}
    >
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>1. Đặt lịch giữ chỗ</Text>
        <Text style={styles.hint}>
          Chạm vào một ô trống để giữ chỗ ({settings?.reservation_hold_minutes ?? 30} phút). Ô đã
          đặt sẽ sáng đèn LED.
        </Text>

        <SlotGrid
          slots={slots}
          selectedSlotId={selectedSlotId}
          showDetails={false}
          onSelectSlot={(slot) => {
            if (slot.status !== 'FREE') {
              Alert.alert('Ô không khả dụng', `Ô ${slot.id} hiện ở trạng thái ${slot.status}`);
              return;
            }
            setSelectedSlotId(slot.id);
          }}
        />

        <TextInput
          style={styles.input}
          value={reserveNote}
          onChangeText={setReserveNote}
          placeholder="Ghi chú đặt lịch (tùy chọn)"
        />

        <TouchableOpacity
          style={[styles.primaryBtn, (!selectedSlotId || submitting) && { opacity: 0.5 }]}
          onPress={handleReserve}
          disabled={!selectedSlotId || submitting}
        >
          <Text style={styles.primaryBtnText}>
            {selectedSlotId ? `Giữ chỗ ô ${selectedSlotId}` : 'Chọn ô trống để đặt lịch'}
          </Text>
        </TouchableOpacity>

        {reservations.slice(0, 4).map((r) => (
          <View key={r.id} style={styles.listItem}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>Ô {r.slot_id}</Text>
              <Text style={styles.itemSub}>Hết hạn: {formatDateTime(r.expires_at)}</Text>
            </View>
            <StatusBadge status={r.status} />
            {r.status === 'ACTIVE' && (
              <TouchableOpacity
                style={styles.cancelChip}
                onPress={() => handleCancelReservation(r.id)}
              >
                <Text style={styles.cancelChipText}>Hủy</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>2. Yêu cầu để xe qua đêm</Text>
        <Text style={styles.hint}>
          Phí qua đêm cố định: {formatVnd(settings?.overnight_fee_vnd ?? 30000)}. Cần tạo trước khi
          vượt quá {settings?.max_duration_minutes ?? 240} phút đỗ xe và cần Người điều hành duyệt
          trước khi áp dụng.
        </Text>

        <TextInput
          style={styles.input}
          value={overnightReason}
          onChangeText={setOvernightReason}
          placeholder="Lý do để xe qua đêm (vd: Công tác qua đêm)"
        />

        <TouchableOpacity
          style={[styles.overnightBtn, submitting && { opacity: 0.5 }]}
          onPress={handleOvernight}
          disabled={submitting}
        >
          <Text style={styles.primaryBtnText}>Gửi yêu cầu qua đêm</Text>
        </TouchableOpacity>

        {overnightRequests.slice(0, 5).map((req) => {
          const canCancel =
            req.status === 'PENDING' || (req.status === 'APPROVED' && req.session_id === null);
          return (
            <View key={req.id} style={styles.listItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{req.reason}</Text>
                <Text style={styles.itemSub}>
                  {req.session_id
                    ? `Phiên #${req.session_id}`
                    : req.status === 'APPROVED'
                      ? 'Chờ áp dụng khi vào cổng'
                      : 'Chưa gắn phiên'}{' '}
                  • {formatDateTime(req.created_at)}
                </Text>
                {req.operator_note ? (
                  <Text style={[styles.itemSub, { color: COLORS.primary, marginTop: 2 }]}>
                    Phản hồi: {req.operator_note}
                  </Text>
                ) : null}
              </View>
              <StatusBadge status={req.status} />
              {canCancel && (
                <TouchableOpacity
                  style={styles.cancelChip}
                  onPress={() => handleCancelOvernight(req.id)}
                >
                  <Text style={styles.cancelChipText}>Hủy</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
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
    gap: 16,
    paddingBottom: 28,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.dark,
  },
  hint: {
    fontSize: 12,
    color: COLORS.muted,
  },
  input: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  overnightBtn: {
    backgroundColor: COLORS.dark,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 14,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.dark,
  },
  itemSub: {
    fontSize: 12,
    color: COLORS.muted,
  },
  cancelChip: {
    backgroundColor: COLORS.dangerSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  cancelChipText: {
    color: COLORS.danger,
    fontWeight: '700',
    fontSize: 12,
  },
});
