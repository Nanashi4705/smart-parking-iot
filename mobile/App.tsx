import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { ParkingProvider } from './src/context/ParkingContext';
import { RootNavigator } from './src/navigation/RootNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <ParkingProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </ParkingProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
