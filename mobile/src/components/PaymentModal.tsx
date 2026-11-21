import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { COLORS, formatVnd } from '../theme';
import { FeeBreakdown, ParkingSession } from '../types';

interface PaymentModalProps {
  visible: boolean;
  session: ParkingSession | null;
  feeBreakdown: FeeBreakdown | null;
  walletBalance: number;
  onClose: () => void;
  onConfirmPay: (method: 'WALLET' | 'MOCK_QR') => Promise<void>;
}

export function PaymentModal({
  visible,
  session,
  feeBreakdown,
  walletBalance,
  onClose,
  onConfirmPay,
}: PaymentModalProps) {
  const [method, setMethod] = useState<'WALLET' | 'MOCK_QR'>('WALLET');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session || !feeBreakdown) return null;

  const canPayWallet = walletBalance >= feeBreakdown.totalFee;

  const handlePay = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onConfirmPay(method);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Thanh toán phí gửi xe</Text>
          <Text style={styles.subtitle}>
            Phiên #{session.id} {session.slot_id ? `• Ô ${session.slot_id}` : ''}
          </Text>

          <View style={styles.billBox}>
            <View style={styles.billRow}>
              <Text style={styles.billLabel}>Thời gian gửi</Text>
              <Text style={styles.billValue}>{feeBreakdown.durationMinutes} phút</Text>
            </View>
            {feeBreakdown.baseFee > 0 && (
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Phí đỗ theo giờ</Text>
                <Text style={styles.billValue}>{formatVnd(feeBreakdown.baseFee)}</Text>
              </View>
            )}
            {feeBreakdown.overnightFee > 0 && (
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Phí gửi qua đêm</Text>
                <Text style={styles.billValue}>{formatVnd(feeBreakdown.overnightFee)}</Text>
              </View>
            )}
            {feeBreakdown.penaltyFee > 0 && (
              <View style={styles.billRow}>
                <Text style={[styles.billLabel, { color: COLORS.danger }]}>
                  Phạt quá thời gian quy định
                </Text>
                <Text style={[styles.billValue, { color: COLORS.danger }]}>
                  {formatVnd(feeBreakdown.penaltyFee)}
                </Text>
              </View>
            )}
            <View style={styles.divider} />
            <View style={styles.billRow}>
              <Text style={styles.totalLabel}>Tổng thanh toán</Text>
              <Text style={styles.totalValue}>{formatVnd(feeBreakdown.totalFee)}</Text>
            </View>
          </View>

          <View style={styles.methodRow}>
            <TouchableOpacity
              style={[styles.methodBtn, method === 'WALLET' && styles.methodActive]}
              onPress={() => setMethod('WALLET')}
            >
              <Text style={[styles.methodText, method === 'WALLET' && styles.methodTextActive]}>
                Ví ({formatVnd(walletBalance)})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.methodBtn, method === 'MOCK_QR' && styles.methodActive]}
              onPress={() => setMethod('MOCK_QR')}
            >
              <Text style={[styles.methodText, method === 'MOCK_QR' && styles.methodTextActive]}>
                QR Chuyển khoản
              </Text>
            </TouchableOpacity>
          </View>

          {method === 'MOCK_QR' && (
            <View style={styles.qrPreview}>
              <QRCode
                value={`PARKING-PAY:${session.id}:${feeBreakdown.totalFee}`}
                size={140}
              />
              <Text style={styles.qrHint}>
                Quét mã chuyển khoản mô phỏng {formatVnd(feeBreakdown.totalFee)} rồi bấm Xác nhận
              </Text>
            </View>
          )}

          {method === 'WALLET' && !canPayWallet && (
            <Text style={styles.errorText}>
              Số dư ví không đủ. Vui lòng nạp thêm ở Hồ sơ hoặc chọn QR Chuyển khoản.
            </Text>
          )}

          {error && <Text style={styles.errorText}>{error}</Text>}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={submitting}>
              <Text style={styles.cancelText}>Đóng</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.payBtn,
                ((method === 'WALLET' && !canPayWallet) || submitting) && styles.btnDisabled,
              ]}
              onPress={handlePay}
              disabled={(method === 'WALLET' && !canPayWallet) || submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.payText}>Thanh toán & Mở Barrier</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
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
  billBox: {
    backgroundColor: COLORS.bg,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  billRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  billLabel: {
    fontSize: 14,
    color: COLORS.muted,
  },
  billValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.dark,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 4,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.dark,
  },
  totalValue: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.primary,
  },
  methodRow: {
    flexDirection: 'row',
    gap: 10,
  },
  methodBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  methodActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primarySoft,
  },
  methodText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.muted,
  },
  methodTextActive: {
    color: COLORS.primary,
  },
  qrPreview: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  qrHint: {
    fontSize: 12,
    color: COLORS.muted,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 13,
    color: COLORS.danger,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
  },
  cancelText: {
    fontWeight: '700',
    color: COLORS.dark,
  },
  payBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  payText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
});
