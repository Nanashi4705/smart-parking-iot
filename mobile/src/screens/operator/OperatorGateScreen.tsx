import React, { useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { StatusBadge } from '../../components/StatusBadge';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../context/AuthContext';
import { useParking } from '../../context/ParkingContext';
import { COLORS, formatDateTime } from '../../theme';

export function OperatorGateScreen() {
  const { serverUrl, token } = useAuth();
  const { gateStatus, gateLogs, refreshing, refreshAll } = useParking();
  const [busy, setBusy] = useState(false);

  const sendBarrierAction = async (action: 'OPEN_HOLD' | 'OPEN_AUTO' | 'CLOSE') => {
    setBusy(true);
    try {
      await apiRequest(serverUrl, '/api/gate/barrier', {
        method: 'POST',
        token,
        body: JSON.stringify({ action }),
      });
      await refreshAll();
    } catch (err) {
      Alert.alert('Lỗi điều khiển cổng', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const qrSecret = gateStatus?.gateQrValue || 'SMART_PARKING_GATE_MAIN_V1';

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} />}
    >
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Trạng thái cổng & Gateway</Text>
          <StatusBadge status={gateStatus?.gateway.online ? 'APPROVED' : 'OPEN'} />
        </View>
        <Text style={styles.meta}>
          Gateway ESP32: {gateStatus?.gateway.online ? 'Đang kết nối' : 'Chưa kết nối'}{' '}
          {gateStatus?.gateway.ip ? `(${gateStatus.gateway.ip})` : ''}
        </Text>
        <Text style={styles.meta}>
          Barrier hiện tại: <Text style={styles.bold}>{gateStatus?.barrierState ?? 'CLOSED'}</Text>
        </Text>
        <Text style={styles.meta}>
          Cảm biến cổng:{' '}
          {gateStatus?.carAtGate
            ? `Có xe dưới cổng (${gateStatus.gateDistanceCm} cm)`
            : 'Thông thoáng'}
        </Text>

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.ctrlBtn, { backgroundColor: COLORS.success }]}
            onPress={() => sendBarrierAction('OPEN_HOLD')}
            disabled={busy}
          >
            <Text style={styles.ctrlBtnText}>Mở giữ</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ctrlBtn, { backgroundColor: COLORS.primary }]}
            onPress={() => sendBarrierAction('OPEN_AUTO')}
            disabled={busy}
          >
            <Text style={styles.ctrlBtnText}>Mở tự động</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ctrlBtn, { backgroundColor: COLORS.danger }]}
            onPress={() => sendBarrierAction('CLOSE')}
            disabled={busy}
          >
            <Text style={styles.ctrlBtnText}>Đóng</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.card, { alignItems: 'center' }]}>
        <Text style={styles.sectionTitle}>Mã QR Cổng Vào / Ra</Text>
        <Text style={styles.metaCenter}>
          In hoặc trưng bày mã này tại cổng để người dùng quét bằng App khi vào và ra
        </Text>
        <View style={styles.qrBox}>
          <QRCode value={qrSecret} size={170} />
        </View>
        <Text style={styles.qrText}>{qrSecret}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Nhật ký đóng/mở cổng & RFID khẩn cấp</Text>
        {gateLogs.length === 0 ? (
          <Text style={styles.meta}>Chưa có sự kiện nào.</Text>
        ) : (
          gateLogs.slice(0, 15).map((log) => (
            <View key={log.id} style={styles.logItem}>
              <View style={styles.rowBetween}>
                <Text style={styles.logTitle}>{log.event_type}</Text>
                <Text style={styles.logRole}>{log.actor_role}</Text>
              </View>
              <Text style={styles.logDetail}>{log.detail || log.rfid_uid || log.actor_uid}</Text>
              <Text style={styles.logTime}>{formatDateTime(log.created_at)}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, gap: 14, paddingBottom: 28 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: COLORS.dark },
  meta: { fontSize: 13, color: COLORS.muted },
  metaCenter: { fontSize: 12, color: COLORS.muted, textAlign: 'center' },
  bold: { fontWeight: '800', color: COLORS.dark },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  ctrlBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  ctrlBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  qrBox: {
    padding: 14,
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginVertical: 4,
  },
  qrText: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  logItem: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 2,
  },
  logTitle: { fontSize: 13, fontWeight: '800', color: COLORS.dark },
  logRole: { fontSize: 11, fontWeight: '800', color: COLORS.primary },
  logDetail: { fontSize: 12, color: COLORS.muted },
  logTime: { fontSize: 11, color: COLORS.muted },
});
