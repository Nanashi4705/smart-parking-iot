import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';
import { OperatorDashboardScreen } from '../screens/operator/OperatorDashboardScreen';
import { OperatorFaultsScreen } from '../screens/operator/OperatorFaultsScreen';
import { OperatorGateScreen } from '../screens/operator/OperatorGateScreen';
import { OperatorSettingsScreen } from '../screens/operator/OperatorSettingsScreen';
import { COLORS } from '../theme';

const Tab = createBottomTabNavigator();

export function OperatorTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.muted,
        tabBarIcon: ({ color, size }) => {
          const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
            Dashboard: 'grid-outline',
            Gate: 'shield-checkmark-outline',
            Faults: 'warning-outline',
            Settings: 'settings-outline',
          };
          return <Ionicons name={iconMap[route.name] || 'ellipse'} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={OperatorDashboardScreen} options={{ title: 'Điều hành' }} />
      <Tab.Screen name="Gate" component={OperatorGateScreen} options={{ title: 'Cổng & QR' }} />
      <Tab.Screen name="Faults" component={OperatorFaultsScreen} options={{ title: 'Báo lỗi' }} />
      <Tab.Screen name="Settings" component={OperatorSettingsScreen} options={{ title: 'Cài đặt' }} />
    </Tab.Navigator>
  );
}
