import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { PaymentModal } from '../../components/PaymentModal';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../context/AuthContext';
import { useParking } from '../../context/ParkingContext';
import { COLORS } from '../../theme';
import { FeeBreakdown, ParkingSession } from '../../types';

interface ScanQrResponse {
  action: 'CHECK_IN' | 'CHECK_OUT_PAYMENT_REQUIRED';
  message: string;
  session: ParkingSession;
  feeBreakdown: FeeBreakdown | null;
}

export function UserScanScreen() {
  const { serverUrl, token, user, refreshMe } = useAuth();
  const { activeSession, refreshAll } = useParking();
  const [permission, requestPermission] = useCameraPermissions();

  const [manualCode, setManualCode] = useState('');
  const [processing, setProcessing] = useState(false);
  const [scannedPaused, setScannedPaused] = useState(false);

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [pendingSession, setPendingSession] = useState<ParkingSession | null>(null);
  const [pendingFee, setPendingFee] = useState<FeeBreakdown | null>(null);

  const submitQrCode = async (qrCode: string) => {
    if (processing) return;
    setProcessing(true);
    setScannedPaused(true);
    try {
      const res = await apiRequest<ScanQrResponse>(serverUrl, '/api/gate/scan-qr', {
        method: 'POST',
        token,
        body: JSON.stringify({ qrCode }),
      });

      await refreshAll();

      if (res.action === 'CHECK_IN') {
        Alert.alert('Vào cổng thành công', res.message);
      } else {
        setPendingSession(res.session);
        setPendingFee(res.feeBreakdown);
        setPaymentModalOpen(true);
      }
    } catch (err) {
      Alert.alert('Quét mã thất bại', (err as Error).message);
    } finally {
      setProcessing(false);
    }
  };

  const handleConfirmPay = async (method: 'WALLET' | 'MOCK_QR') => {
    if (!pendingSession) return;
    const res = await apiRequest<{ message: string }>(
      serverUrl,
      `/api/sessions/${pendingSession.id}/pay`,
      {
        method: 'POST',
        token,
        body: JSON.stringify({ paymentMethod: method }),
      },
    );
    setPaymentModalOpen(false);
    setPendingSession(null);
    setPendingFee(null);
    await Promise.all([refreshMe(), refreshAll()]);
    Alert.alert('Hoàn tất', res.message);
  };

  const openPendingFromSession = () => {
    if (!activeSession || !activeSession.liveFee) return;
    setPendingSession(activeSession);
    setPendingFee(activeSession.liveFee);
    setPaymentModalOpen(true);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>
        {activeSession ? 'Quét mã QR cổng để ra & thanh toán' : 'Quét mã QR cổng để vào bãi'}
      </Text>
      <Text style={styles.subtitle}>
        Định danh gửi xe của bạn: <Text style={styles.bold}>{user?.uid}</Text>
      </Text>

      {activeSession?.status === 'PENDING_PAYMENT' && (
        <TouchableOpacity style={styles.pendingBanner} onPress={openPendingFromSession}>
          <Text style={styles.pendingBannerTitle}>Phiên #{activeSession.id} đang chờ thanh toán</Text>
          <Text style={styles.pendingBannerSub}>Nhấn vào đây để mở lại hóa đơn thanh toán</Text>
        </TouchableOpacity>
      )}

      <View style={styles.cameraCard}>
        {!permission ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : !permission.granted ? (
          <View style={styles.permBox}>
            <Text style={styles.permText}>
              Ứng dụng cần quyền Camera để quét mã QR dán tại cổng bãi đỗ xe.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
              <Text style={styles.primaryBtnText}>Cấp quyền Camera</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.cameraWrap}>
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={
                scannedPaused
                  ? undefined
                  : ({ data }) => {
                      if (data) submitQrCode(data);
                    }
              }
            />
            {scannedPaused && (
              <View style={styles.pauseOverlay}>
                {processing ? (
                  <ActivityIndicator size="large" color="#FFF" />
                ) : (
                  <TouchableOpacity
                    style={styles.rescanBtn}
                    onPress={() => setScannedPaused(false)}
                  >
                    <Text style={styles.rescanText}>Nhấn để quét lại</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}
      </View>

      <View style={styles.manualCard}>
        <Text style={styles.manualTitle}>Nhập mã cổng thủ công (khi test không dùng camera)</Text>
        <View style={styles.manualRow}>
          <TextInput
            style={styles.input}
            value={manualCode}
            onChangeText={setManualCode}
            placeholder="SMART_PARKING_GATE_MAIN_V1"
            autoCapitalize="characters"
          />
          <TouchableOpacity
            style={styles.submitManualBtn}
            onPress={() => submitQrCode(manualCode || 'SMART_PARKING_GATE_MAIN_V1')}
            disabled={processing}
          >
            <Text style={styles.submitManualText}>Xác nhận</Text>
          </TouchableOpacity>
        </View>
      </View>

      <PaymentModal
        visible={paymentModalOpen}
        session={pendingSession}
        feeBreakdown={pendingFee}
        walletBalance={user?.walletBalance ?? 0}
        onClose={() => setPaymentModalOpen(false)}
        onConfirmPay={handleConfirmPay}
      />
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
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.dark,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.muted,
    marginTop: -8,
  },
  bold: {
    fontWeight: '800',
    color: COLORS.primary,
  },
  pendingBanner: {
    backgroundColor: COLORS.warningSoft,
    borderWidth: 1,
    borderColor: COLORS.warning,
    borderRadius: 12,
    padding: 12,
  },
  pendingBannerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.warning,
  },
  pendingBannerSub: {
    fontSize: 12,
    color: COLORS.dark,
    marginTop: 2,
  },
  cameraCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    height: 320,
    justifyContent: 'center',
  },
  permBox: {
    padding: 20,
    alignItems: 'center',
    gap: 12,
  },
  permText: {
    fontSize: 14,
    color: COLORS.muted,
    textAlign: 'center',
  },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
  },
  primaryBtnText: {
    color: '#FFF',
    fontWeight: '700',
  },
  cameraWrap: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  pauseOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rescanBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
  },
  rescanText: {
    color: '#FFF',
    fontWeight: '800',
  },
  manualCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  manualTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.dark,
  },
  manualRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  submitManualBtn: {
    backgroundColor: COLORS.dark,
    paddingHorizontal: 14,
    borderRadius: 10,
    justifyContent: 'center',
  },
  submitManualText: {
    color: '#FFF',
    fontWeight: '700',
  },
});
