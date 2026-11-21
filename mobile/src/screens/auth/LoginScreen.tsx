import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { COLORS } from '../../theme';

export function LoginScreen({
  navigation,
}: {
  navigation: NativeStackNavigationProp<Record<string, undefined>>;
}) {
  const { serverUrl, updateServerUrl, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [editingServer, setEditingServer] = useState(false);
  const [serverDraft, setServerDraft] = useState(serverUrl);
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      Alert.alert('Thiếu thông tin', 'Vui lòng nhập tên đăng nhập và mật khẩu');
      return;
    }
    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      Alert.alert('Đăng nhập thất bại', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveServer = async () => {
    if (!serverDraft.trim()) return;
    await updateServerUrl(serverDraft);
    setEditingServer(false);
    Alert.alert('Đã lưu', `Địa chỉ Server: ${serverDraft.trim()}`);
  };

  const fillDemo = (user: string, pass: string) => {
    setUsername(user);
    setPassword(pass);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brandBox}>
          <Text style={styles.brandTag}>SMART PARKING IoT</Text>
          <Text style={styles.title}>Bãi Đỗ Xe Thông Minh</Text>
          <Text style={styles.subtitle}>
            Quản lý chỗ trống, quét QR cổng & điều hành barrier realtime
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Tên đăng nhập</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            placeholder="Nhập username (vd: user1, admin)"
          />

          <Text style={styles.label}>Mật khẩu</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Nhập mật khẩu"
          />

          <TouchableOpacity
            style={[styles.primaryBtn, submitting && { opacity: 0.6 }]}
            onPress={handleLogin}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.primaryBtnText}>Đăng nhập</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => navigation.navigate('Register')}
          >
            <Text style={styles.linkText}>Chưa có tài khoản? Đăng ký xe mới</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.demoCard}>
          <Text style={styles.demoTitle}>Điền nhanh tài khoản demo (mật khẩu: 123456)</Text>
          <View style={styles.demoRow}>
            <TouchableOpacity style={styles.demoChip} onPress={() => fillDemo('user1', '123456')}>
              <Text style={styles.demoChipText}>User 1</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.demoChip} onPress={() => fillDemo('user2', '123456')}>
              <Text style={styles.demoChipText}>User 2</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.demoChip, { backgroundColor: COLORS.purpleSoft }]}
              onPress={() => fillDemo('admin', '123456')}
            >
              <Text style={[styles.demoChipText, { color: COLORS.purple }]}>Điều hành</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.serverCard}>
          <View style={styles.serverHeader}>
            <Text style={styles.serverLabel}>Backend: {serverUrl}</Text>
            <TouchableOpacity
              onPress={() => {
                setServerDraft(serverUrl);
                setEditingServer((v) => !v);
              }}
            >
              <Text style={styles.editLink}>{editingServer ? 'Đóng' : 'Đổi IP'}</Text>
            </TouchableOpacity>
          </View>
          {editingServer && (
            <View style={styles.serverEditRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={serverDraft}
                onChangeText={setServerDraft}
                autoCapitalize="none"
                placeholder="http://192.168.1.x:3000"
              />
              <TouchableOpacity style={styles.saveIpBtn} onPress={handleSaveServer}>
                <Text style={styles.saveIpText}>Lưu</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    padding: 20,
    paddingTop: 56,
    gap: 16,
  },
  brandBox: {
    gap: 4,
    marginBottom: 4,
  },
  brandTag: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: COLORS.dark,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.muted,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.dark,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    marginBottom: 14,
    color: COLORS.dark,
  },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16,
  },
  linkBtn: {
    marginTop: 14,
    alignItems: 'center',
  },
  linkText: {
    color: COLORS.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  demoCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  demoTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.muted,
  },
  demoRow: {
    flexDirection: 'row',
    gap: 8,
  },
  demoChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: COLORS.primarySoft,
    alignItems: 'center',
  },
  demoChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  serverCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  serverHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  serverLabel: {
    fontSize: 12,
    color: COLORS.muted,
    flex: 1,
  },
  editLink: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  serverEditRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  saveIpBtn: {
    backgroundColor: COLORS.dark,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
  },
  saveIpText: {
    color: '#FFF',
    fontWeight: '700',
  },
});
