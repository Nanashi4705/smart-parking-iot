import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const SERVER_URL_KEY = 'smart_parking_server_url';

export function detectDefaultServerUrl(): string {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as unknown as { manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } } })
      .manifest2?.extra?.expoGo?.debuggerHost;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host && host !== '127.0.0.1' && host !== 'localhost') {
      return `http://${host}:3000`;
    }
  }

  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:3000';
  }
  return 'http://localhost:3000';
}

export async function getSavedServerUrl(): Promise<string> {
  const saved = await AsyncStorage.getItem(SERVER_URL_KEY);
  return saved || detectDefaultServerUrl();
}

export async function saveServerUrl(url: string): Promise<string> {
  const normalized = url.trim().replace(/\/+$/, '');
  await AsyncStorage.setItem(SERVER_URL_KEY, normalized);
  return normalized;
}

export function buildWsUrl(httpBaseUrl: string): string {
  const clean = httpBaseUrl.trim().replace(/\/+$/, '');
  if (clean.startsWith('https://')) {
    return `wss://${clean.slice('https://'.length)}/ws`;
  }
  if (clean.startsWith('http://')) {
    return `ws://${clean.slice('http://'.length)}/ws`;
  }
  return `ws://${clean}/ws`;
}

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { error: text || 'Lỗi phản hồi từ server' };
  }

  if (!response.ok) {
    throw new Error(String(data.error || `Lỗi HTTP ${response.status}`));
  }

  return data as T;
}
