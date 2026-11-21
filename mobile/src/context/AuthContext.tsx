import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiRequest, getSavedServerUrl, saveServerUrl } from '../config/api';
import { User } from '../types';

const TOKEN_KEY = 'smart_parking_auth_token';

interface AuthContextValue {
  serverUrl: string;
  token: string | null;
  user: User | null;
  initializing: boolean;
  updateServerUrl: (url: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (payload: {
    username: string;
    password: string;
    fullName: string;
    licensePlate: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  topUpWallet: (amount: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [serverUrl, setServerUrl] = useState<string>('http://localhost:3000');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [savedUrl, savedToken] = await Promise.all([
          getSavedServerUrl(),
          AsyncStorage.getItem(TOKEN_KEY),
        ]);
        setServerUrl(savedUrl);
        if (savedToken) {
          const me = await apiRequest<{ user: User }>(savedUrl, '/api/auth/me', {
            token: savedToken,
          });
          setToken(savedToken);
          setUser(me.user);
        }
      } catch {
        await AsyncStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      } finally {
        setInitializing(false);
      }
    })();
  }, []);

  const updateServerUrl = async (url: string) => {
    const normalized = await saveServerUrl(url);
    setServerUrl(normalized);
  };

  const login = async (username: string, password: string) => {
    const res = await apiRequest<{ token: string; user: User }>(serverUrl, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    await AsyncStorage.setItem(TOKEN_KEY, res.token);
    setToken(res.token);
    setUser(res.user);
  };

  const register = async (payload: {
    username: string;
    password: string;
    fullName: string;
    licensePlate: string;
  }) => {
    const res = await apiRequest<{ token: string; user: User }>(serverUrl, '/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await AsyncStorage.setItem(TOKEN_KEY, res.token);
    setToken(res.token);
    setUser(res.user);
  };

  const logout = async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  };

  const refreshMe = async () => {
    if (!token) return;
    const res = await apiRequest<{ user: User }>(serverUrl, '/api/auth/me', { token });
    setUser(res.user);
  };

  const topUpWallet = async (amount: number) => {
    if (!token) return;
    const res = await apiRequest<{ user: User }>(serverUrl, '/api/auth/wallet/topup', {
      method: 'POST',
      token,
      body: JSON.stringify({ amount }),
    });
    setUser(res.user);
  };

  return (
    <AuthContext.Provider
      value={{
        serverUrl,
        token,
        user,
        initializing,
        updateServerUrl,
        login,
        register,
        logout,
        refreshMe,
        topUpWallet,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
