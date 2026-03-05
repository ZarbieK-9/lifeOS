import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { QuickCaptureButton } from '@/src/components/QuickCaptureButton';

const TAB_BAR_BASE = 50;
const MIN_BOTTOM_INSET = 16;
export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const bottomInset = Math.max(insets.bottom, MIN_BOTTOM_INSET);
  const tabBarHeight = TAB_BAR_BASE + bottomInset;

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: theme.tabActive,
          tabBarInactiveTintColor: theme.tabInactive,
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarStyle: {
            height: tabBarHeight,
            paddingTop: 8,
            paddingBottom: bottomInset,
            backgroundColor: theme.tabBarBg,
            borderTopWidth: 1,
            borderTopColor: theme.border,
            elevation: 0,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -1 },
            shadowOpacity: Platform.OS === 'ios' ? 0.08 : 0,
            shadowRadius: 4,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'AI',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="brain" color={color} />,
          }}
        />
        <Tabs.Screen
          name="dashboard"
          options={{
            title: 'Dash',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="chart.bar.fill" color={color} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'More',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="gearshape.fill" color={color} />,
          }}
        />
        {/* Hidden tabs — keep routes for deep links / future */}
        <Tabs.Screen name="tasks" options={{ href: null }} />
        <Tabs.Screen name="partner" options={{ href: null }} />
        <Tabs.Screen name="ai" options={{ href: null }} />
        <Tabs.Screen name="explore" options={{ href: null }} />
      </Tabs>
      <QuickCaptureButton />
    </View>
  );
}
