import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';
import { UserHomeScreen } from '../screens/user/UserHomeScreen';
import { UserProfileScreen } from '../screens/user/UserProfileScreen';
import { UserRequestsScreen } from '../screens/user/UserRequestsScreen';
import { UserScanScreen } from '../screens/user/UserScanScreen';
import { COLORS } from '../theme';

const Tab = createBottomTabNavigator();

export function UserTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.muted,
        tabBarIcon: ({ color, size }) => {
          const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
            Home: 'car-outline',
            Scan: 'qr-code-outline',
            Requests: 'calendar-outline',
            Profile: 'person-outline',
          };
          return <Ionicons name={iconMap[route.name] || 'ellipse'} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={UserHomeScreen} options={{ title: 'Bãi xe' }} />
      <Tab.Screen name="Scan" component={UserScanScreen} options={{ title: 'Quét QR' }} />
      <Tab.Screen name="Requests" component={UserRequestsScreen} options={{ title: 'Đặt lịch' }} />
      <Tab.Screen name="Profile" component={UserProfileScreen} options={{ title: 'Hồ sơ' }} />
    </Tab.Navigator>
  );
}
