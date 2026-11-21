import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../context/AuthContext';
import { useParking } from '../../context/ParkingContext';
import { COLORS } from '../../theme';

export function OperatorSettingsScreen() {
  const { serverUrl, token, user, logout } = useAuth();
  const { settings, refreshAll } = useParking();

  const [hourlyRate, setHourlyRate] = useState('5000');
  const [overnightFee, setOvernightFee] = useState('30000');
  const [maxDuration, setMaxDuration] = useState('240');
  const [penaltyFlat, setPenaltyFlat] = useState('50000');
  const [penaltyPerHour, setPenaltyPerHour] = useState('10000');
  const [reserveHold, setReserveHold] = useState('30');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setHourlyRate(String(settings.hourly_rate_vnd));
    setOvernightFee(String(settings.overnight_fee_vnd));
    setMaxDuration(String(settings.max_duration_minutes));
    setPenaltyFlat(String(settings.penalty_flat_vnd));
    setPenaltyPerHour(String(settings.penalty_per_hour_vnd));
    setReserveHold(String(settings.reservation_hold_minutes));
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiRequest(serverUrl, '/api/settings', {
        method: 'PUT',
        token,
        body: JSON.stringify({
          hourly_rate_vnd: Number(hourlyRate),
          overnight_fee_vnd: Number(overnightFee),
          max_duration_minutes: Number(maxDuration),
          penalty_flat_vnd: Number(penaltyFlat),
          penalty_per_hour_vnd: Number(penaltyPerHour),
          reservation_hold_minutes: Number(reserveHold),
        }),
      });
      await refreshAll();
      Alert.alert('Đã lưu', 'Cấu hình giá và thời gian phạt đã được cập nhật.');
    } catch (err) {
      Alert.alert('Lỗi lưu cấu hình', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>Cấu hình giá & Thời hạn phạt</Text>
        <Text style={styles.sub}>Tài khoản: {user?.fullName} ({user?.uid})</Text>

        <View style={styles.presetRow}>
          <TouchableOpacity style={styles.presetBtn} onPress={() => setMaxDuration('2')}>
            <Text style={styles.presetText}>Demo nhanh: Quá giờ 2 phút</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.presetBtn} onPress={() => setMaxDuration('240')}>
            <Text style={styles.presetText}>Mặc định: 4 giờ (240p)</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Đơn giá gửi xe theo giờ (VNĐ)</Text>
        <TextInput style={styles.input} value={hourlyRate} onChangeText={setHourlyRate} keyboardType="numeric" />

        <Text style={styles.label}>Phí gửi xe qua đêm cố định (VNĐ)</Text>
        <TextInput style={styles.input} value={overnightFee} onChangeText={setOvernightFee} keyboardType="numeric" />

        <Text style={styles.label}>Thời lượng đỗ tối đa không bị phạt (phút)</Text>
        <TextInput style={styles.input} value={maxDuration} onChangeText={setMaxDuration} keyboardType="numeric" />

        <Text style={styles.label}>Phí phạt cố định khi quá giờ (VNĐ)</Text>
        <TextInput style={styles.input} value={penaltyFlat} onChangeText={setPenaltyFlat} keyboardType="numeric" />

        <Text style={styles.label}>Phụ thu quá giờ mỗi giờ thêm (VNĐ)</Text>
        <TextInput style={styles.input} value={penaltyPerHour} onChangeText={setPenaltyPerHour} keyboardType="numeric" />

        <Text style={styles.label}>Thời gian giữ chỗ đặt lịch (phút)</Text>
        <TextInput style={styles.input} value={reserveHold} onChangeText={setReserveHold} keyboardType="numeric" />

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveBtnText}>Lưu cấu hình</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutText}>Đăng xuất</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, gap: 14, paddingBottom: 28 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
  },
  title: { fontSize: 18, fontWeight: '800', color: COLORS.dark },
  sub: { fontSize: 12, color: COLORS.muted, marginBottom: 4 },
  presetRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  presetBtn: {
    flex: 1,
    backgroundColor: COLORS.warningSoft,
    padding: 9,
    borderRadius: 10,
    alignItems: 'center',
  },
  presetText: { fontSize: 11, fontWeight: '800', color: COLORS.warning, textAlign: 'center' },
  label: { fontSize: 12, fontWeight: '700', color: COLORS.dark, marginTop: 4 },
  input: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  logoutBtn: {
    backgroundColor: COLORS.dangerSoft,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutText: { color: COLORS.danger, fontWeight: '800', fontSize: 15 },
});
