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
import { StatusBadge } from '../../components/StatusBadge';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../context/AuthContext';
import { useParking } from '../../context/ParkingContext';
import { COLORS, formatDateTime } from '../../theme';
import { FaultReport, FaultStatus } from '../../types';

export function OperatorFaultsScreen() {
  const { serverUrl, token } = useAuth();
  const { faultReports, slots, refreshing, refreshAll } = useParking();

  const [filter, setFilter] = useState<'ALL' | FaultStatus>('ALL');
  const [createOpen, setCreateOpen] = useState(false);
  const [newSlotId, setNewSlotId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const [editingReport, setEditingReport] = useState<FaultReport | null>(null);
  const [editStatus, setEditStatus] = useState<FaultStatus>('IN_PROGRESS');
  const [editNote, setEditNote] = useState('');

  const visibleReports =
    filter === 'ALL' ? faultReports : faultReports.filter((r) => r.status === filter);

  const handleCreate = async () => {
    if (newTitle.trim().length < 2 || newDesc.trim().length < 2) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập tiêu đề và mô tả lỗi');
      return;
    }
    try {
      await apiRequest(serverUrl, '/api/fault-reports', {
        method: 'POST',
        token,
        body: JSON.stringify({
          slotId: newSlotId,
          title: newTitle.trim(),
          description: newDesc.trim(),
        }),
      });
      setCreateOpen(false);
      setNewTitle('');
      setNewDesc('');
      setNewSlotId(null);
      await refreshAll();
    } catch (err) {
      Alert.alert('Lỗi', (err as Error).message);
    }
  };

  const handleUpdate = async () => {
    if (!editingReport) return;
    try {
      await apiRequest(serverUrl, `/api/fault-reports/${editingReport.id}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          status: editStatus,
          operatorNote: editNote.trim() || undefined,
        }),
      });
      setEditingReport(null);
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
      <View style={styles.header}>
        <Text style={styles.title}>Báo cáo lỗi</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setCreateOpen(true)}>
          <Text style={styles.addBtnText}>+ Tạo báo cáo</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        {(['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && styles.filterActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'ALL'
                ? 'Tất cả'
                : f === 'OPEN'
                  ? 'Mới'
                  : f === 'IN_PROGRESS'
                    ? 'Đang xử lý'
                    : 'Đã xử lý'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {visibleReports.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.empty}>Không có phiếu báo cáo lỗi nào.</Text>
        </View>
      ) : (
        visibleReports.map((r) => (
          <TouchableOpacity
            key={r.id}
            style={styles.card}
            onPress={() => {
              setEditingReport(r);
              setEditStatus(r.status);
              setEditNote(r.operator_note || '');
            }}
          >
            <View style={styles.rowBetween}>
              <Text style={styles.reportTitle}>
                #{r.id} • {r.title}
              </Text>
              <StatusBadge status={r.status} />
            </View>
            <Text style={styles.meta}>
              Vị trí: {r.slot_id || 'Cổng / Chung'} • Người báo: {r.reporter_name || r.reporter_uid}
            </Text>
            <Text style={styles.desc}>{r.description}</Text>
            {r.operator_note && (
              <Text style={styles.note}>Ghi chú xử lý: {r.operator_note}</Text>
            )}
            <Text style={styles.time}>Cập nhật: {formatDateTime(r.updated_at)}</Text>
          </TouchableOpacity>
        ))
      )}

      <Modal visible={createOpen} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Tạo phiếu báo cáo lỗi mới</Text>
            <View style={styles.chipRow}>
              <TouchableOpacity
                style={[styles.chip, newSlotId === null && styles.chipActive]}
                onPress={() => setNewSlotId(null)}
              >
                <Text style={styles.chipText}>Cổng / Chung</Text>
              </TouchableOpacity>
              {slots.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.chip, newSlotId === s.id && styles.chipActive]}
                  onPress={() => setNewSlotId(s.id)}
                >
                  <Text style={styles.chipText}>{s.id}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Tiêu đề lỗi"
            />
            <TextInput
              style={styles.input}
              value={newDesc}
              onChangeText={setNewDesc}
              placeholder="Mô tả chi tiết lỗi"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setCreateOpen(false)}>
                <Text style={styles.cancelText}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleCreate}>
                <Text style={styles.saveText}>Lưu phiếu</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={editingReport !== null} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Cập nhật phiếu #{editingReport?.id}</Text>
            <View style={styles.chipRow}>
              {(['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const).map((st) => (
                <TouchableOpacity
                  key={st}
                  style={[styles.chip, editStatus === st && styles.chipActive]}
                  onPress={() => setEditStatus(st)}
                >
                  <Text style={styles.chipText}>
                    {st === 'OPEN' ? 'Mới' : st === 'IN_PROGRESS' ? 'Đang xử lý' : 'Đã xử lý'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={editNote}
              onChangeText={setEditNote}
              placeholder="Ghi chú biện pháp xử lý"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditingReport(null)}>
                <Text style={styles.cancelText}>Đóng</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleUpdate}>
                <Text style={styles.saveText}>Cập nhật</Text>
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
  content: { padding: 16, gap: 12, paddingBottom: 28 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.dark },
  addBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  filterRow: { flexDirection: 'row', gap: 6 },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterText: { fontSize: 12, fontWeight: '700', color: COLORS.muted },
  filterTextActive: { color: '#FFF' },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  },
  empty: { fontSize: 13, color: COLORS.muted },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  reportTitle: { fontSize: 15, fontWeight: '800', color: COLORS.dark, flex: 1 },
  meta: { fontSize: 12, color: COLORS.muted },
  desc: { fontSize: 13, color: COLORS.dark },
  note: { fontSize: 12, color: COLORS.primary, fontWeight: '700' },
  time: { fontSize: 11, color: COLORS.muted },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    gap: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: COLORS.dark },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  chipActive: { backgroundColor: COLORS.primarySoft, borderWidth: 1, borderColor: COLORS.primary },
  chipText: { fontSize: 12, fontWeight: '700', color: COLORS.dark },
  input: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  modalActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
  },
  cancelText: { fontWeight: '700', color: COLORS.dark },
  saveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  saveText: { color: '#FFF', fontWeight: '800' },
});
