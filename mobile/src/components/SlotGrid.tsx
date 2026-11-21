import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../theme';
import { Slot } from '../types';
import { StatusBadge } from './StatusBadge';

interface SlotGridProps {
  slots: Slot[];
  onSelectSlot?: (slot: Slot) => void;
  selectedSlotId?: string | null;
  showDetails?: boolean;
}

function getLedInfo(ledMode: number): { color: string; text: string } {
  switch (ledMode) {
    case 1:
      return { color: '#EF4444', text: 'LED Sáng (Đặt trước)' };
    case 2:
      return { color: '#DC2626', text: 'LED Nhấp nháy (Kiểm tra!)' };
    default:
      return { color: '#CBD5E1', text: 'LED Tắt (Bình thường)' };
  }
}

export function SlotGrid({
  slots,
  onSelectSlot,
  selectedSlotId,
  showDetails = true,
}: SlotGridProps) {
  const floors = [1, 2];

  return (
    <View style={styles.container}>
      {floors.map((floor) => {
        const floorSlots = slots
          .filter((s) => s.floor === floor)
          .sort((a, b) => a.sensor_index - b.sensor_index);

        return (
          <View key={floor} style={styles.floorBox}>
            <Text style={styles.floorTitle}>Tầng {floor}</Text>
            <View style={styles.row}>
              {floorSlots.map((slot) => {
                const led = getLedInfo(slot.led_mode);
                const isSelected = selectedSlotId === slot.id;
                const isAlert = slot.status === 'OVERTIME' || Boolean(slot.wrongOccupancy);
                const CardWrapper = onSelectSlot ? TouchableOpacity : View;

                return (
                  <CardWrapper
                    key={slot.id}
                    style={[
                      styles.slotCard,
                      isAlert && styles.slotAlert,
                      isSelected && styles.slotSelected,
                    ]}
                    onPress={onSelectSlot ? () => onSelectSlot(slot) : undefined}
                    activeOpacity={0.75}
                  >
                    <View style={styles.slotHeader}>
                      <Text style={styles.slotId}>{slot.id}</Text>
                      <View style={[styles.ledDot, { backgroundColor: led.color }]} />
                    </View>

                    <StatusBadge status={slot.status} />

                    {showDetails && (
                      <View style={styles.metaBox}>
                        <Text style={[styles.ledText, slot.led_mode === 2 && { color: COLORS.danger }]}>
                          {led.text}
                        </Text>
                        <Text style={styles.distText}>
                          Siêu âm: {slot.distance_cm >= 900 ? 'Trống' : `${slot.distance_cm} cm`}
                        </Text>
                        {slot.wrongOccupancy && (
                          <Text style={styles.wrongText}>
                            Cảnh báo: Có xe đỗ vào ô đặt/bảo trì!
                          </Text>
                        )}
                        {slot.reservedByUid && slot.status === 'RESERVED' && (
                          <Text style={styles.uidText}>Giữ cho: {slot.reservedByUid}</Text>
                        )}
                        {slot.activeSessionUid && (
                          <Text style={styles.uidText}>
                            Xe: {slot.activeSessionUid}
                            {slot.hasOvernightRequest ? ' (Qua đêm)' : ''}
                          </Text>
                        )}
                      </View>
                    )}
                  </CardWrapper>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  floorBox: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  floorTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.dark,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  slotCard: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    gap: 8,
  },
  slotAlert: {
    borderColor: COLORS.danger,
    backgroundColor: '#FFF5F5',
  },
  slotSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primarySoft,
  },
  slotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  slotId: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.dark,
  },
  ledDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  metaBox: {
    gap: 2,
    marginTop: 2,
  },
  ledText: {
    fontSize: 11,
    color: COLORS.muted,
    fontWeight: '600',
  },
  distText: {
    fontSize: 11,
    color: COLORS.muted,
  },
  wrongText: {
    fontSize: 11,
    color: COLORS.danger,
    fontWeight: '800',
  },
  uidText: {
    fontSize: 11,
    color: COLORS.primary,
    fontWeight: '600',
  },
});
