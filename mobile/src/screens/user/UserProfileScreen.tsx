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
import { StatusBadge } from '../../components/StatusBadge';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../context/AuthContext';
import { useParking } from '../../context/ParkingContext';
import { COLORS, formatDateTime, formatVnd } from '../../theme';

export function UserProfileScreen() {
  const { user, serverUrl, token, topUpWallet, logout } = useAuth();
  const { sessions, faultReports, slots, refreshing, refreshAll } = useParking();

  const [faultSlotId, setFaultSlotId] = useState<string | null>(null);
  const [faultTitle, setFaultTitle] = useState('');
  const [faultDesc, setFaultDesc] = useState('');

  const handleTopUp = async (amount: number) => {
    try {
      await topUpWallet(amount);
      Alert.alert('Nạp tiền thành công', `Đã nạp ${formatVnd(amount)} vào ví mô phỏng`);
    } catch (err) {
      Alert.alert('Lỗi', (err as Error).message);
    }
  };

  const handleSubmitFault = async () => {
    if (faultTitle.trim().length < 2 || faultDesc.trim().length < 2) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập tiêu đề và mô tả sự cố');
      return;
    }
    try {
      await apiRequest(serverUrl, '/api/fault-reports', {
        method: 'POST',
        token,
        body: JSON.stringify({
          slotId: faultSlotId,
          title: faultTitle.trim(),
          description: faultDesc.trim(),
        }),
      });
      setFaultTitle('');
      setFaultDesc('');
      setFaultSlotId(null);
      await refreshAll();
      Alert.alert('Đã gửi', 'Báo cáo lỗi đã được chuyển cho Người điều hành');
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
        <Text style={styles.name}>{user?.fullName}</Text>
        <Text style={styles.meta}>
          UID: {user?.uid} • Biển số: {user?.licensePlate || 'N/A'}
        </Text>

        <View style={styles.walletBox}>
          <View>
            <Text style={styles.walletLabel}>Số dư ví nội bộ</Text>
            <Text style={styles.walletValue}>{formatVnd(user?.walletBalance ?? 0)}</Text>
          </View>
          <View style={styles.topupRow}>
            <TouchableOpacity style={styles.topupBtn} onPress={() => handleTopUp(100000)}>
              <Text style={styles.topupText}>+100k</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.topupBtn} onPress={() => handleTopUp(500000)}>
              <Text style={styles.topupText}>+500k</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Lịch sử gửi xe & Hóa đơn</Text>
        {sessions.length === 0 ? (
          <Text style={styles.empty}>Chưa có lượt gửi xe nào.</Text>
        ) : (
          sessions.slice(0, 8).map((s) => (
            <View key={s.id} style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>
                  Phiên #{s.id} {s.slot_id ? `• Ô ${s.slot_id}` : ''}
                </Text>
                <Text style={styles.itemSub}>
                  Vào: {formatDateTime(s.check_in_time)}
                  {s.check_out_time ? ` | Ra: ${formatDateTime(s.check_out_time)}` : ''}
                </Text>
                <Text style={styles.itemFee}>
                  Tổng: {formatVnd(s.status === 'COMPLETED' ? s.total_fee : s.liveFee?.totalFee ?? 0)}
                  {s.penalty_fee > 0 ? ` (Phạt ${formatVnd(s.penalty_fee)})` : ''}
                </Text>
              </View>
              <StatusBadge status={s.status} />
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Báo cáo sự cố / lỗi</Text>
        <View style={styles.slotChipRow}>
          <TouchableOpacity
            style={[styles.slotChip, faultSlotId === null && styles.slotChipActive]}
            onPress={() => setFaultSlotId(null)}
          >
            <Text style={styles.slotChipText}>Cổng / Chung</Text>
          </TouchableOpacity>
          {slots.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[styles.slotChip, faultSlotId === s.id && styles.slotChipActive]}
              onPress={() => setFaultSlotId(s.id)}
            >
              <Text style={styles.slotChipText}>{s.id}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={styles.input}
          value={faultTitle}
          onChangeText={setFaultTitle}
          placeholder="Tiêu đề lỗi (vd: Đèn ô F1-S1 không sáng)"
        />
        <TextInput
          style={styles.input}
          value={faultDesc}
          onChangeText={setFaultDesc}
          placeholder="Mô tả chi tiết"
        />
        <TouchableOpacity style={styles.primaryBtn} onPress={handleSubmitFault}>
          <Text style={styles.primaryBtnText}>Gửi báo cáo lỗi</Text>
        </TouchableOpacity>

        {faultReports.slice(0, 4).map((f) => (
          <View key={f.id} style={styles.itemRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{f.title}</Text>
              <Text style={styles.itemSub}>
                {f.slot_id || 'Chung'} • {f.operator_note || f.description}
              </Text>
            </View>
            <StatusBadge status={f.status} />
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutText}>Đăng xuất</Text>
      </TouchableOpacity>
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
    paddingBottom: 32,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  name: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.dark,
  },
  meta: {
    fontSize: 13,
    color: COLORS.muted,
    marginTop: -6,
  },
  walletBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.primarySoft,
    padding: 12,
    borderRadius: 12,
  },
  walletLabel: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '700',
  },
  walletValue: {
    fontSize: 20,
    fontWeight: '900',
    color: COLORS.primary,
  },
  topupRow: {
    flexDirection: 'row',
    gap: 8,
  },
  topupBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  topupText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.dark,
  },
  empty: {
    fontSize: 13,
    color: COLORS.muted,
  },
  itemRow: {
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
  itemFee: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  slotChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  slotChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  slotChipActive: {
    backgroundColor: COLORS.primarySoft,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  slotChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.dark,
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
    backgroundColor: COLORS.dark,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#FFF',
    fontWeight: '800',
  },
  logoutBtn: {
    backgroundColor: COLORS.dangerSoft,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutText: {
    color: COLORS.danger,
    fontWeight: '800',
    fontSize: 15,
  },
});
