import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Home, Brain, UserRound } from 'lucide-react-native';

import { HapticTab } from '@/components/haptic-tab';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { useStore } from '@/src/store/useStore';
import { QuickCaptureButton } from '@/src/components/QuickCaptureButton';
import { useThemeContext } from '@/src/context/ThemeContext';

const TAB_BAR_BASE = 50;
const MIN_BOTTOM_INSET = 16;
export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { resolvedMode } = useThemeContext();
  const watcherCount = useStore((s) => s.watcherQueue.length);
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
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            borderTopColor: theme.border,
            elevation: 0,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -1 },
            shadowOpacity: Platform.OS === 'ios' ? 0.08 : 0,
            shadowRadius: 4,
          },
          tabBarBackground: () => (
            <BlurView intensity={70} tint={resolvedMode === 'dark' ? 'dark' : 'light'} style={{ flex: 1 }} />
          ),
          tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color }) => <Home size={22} color={color} strokeWidth={1.8} />,
            tabBarBadge: watcherCount > 0 ? watcherCount : undefined,
            tabBarBadgeStyle: { backgroundColor: theme.primary, fontSize: 10 },
          }}
        />
        <Tabs.Screen
          name="ai"
          options={{
            title: 'AI',
            tabBarIcon: ({ color }) => <Brain size={22} color={color} strokeWidth={1.8} />,
          }}
        />
        <Tabs.Screen
          name="me"
          options={{
            title: 'Me',
            tabBarIcon: ({ color }) => <UserRound size={22} color={color} strokeWidth={1.8} />,
          }}
        />
        {/* Hidden tabs — keep routes for deep links / future */}
        <Tabs.Screen name="dashboard" options={{ href: null }} />
        <Tabs.Screen name="settings" options={{ href: null }} />
        <Tabs.Screen name="tasks" options={{ href: null }} />
        <Tabs.Screen name="partner" options={{ href: null }} />
        <Tabs.Screen name="explore" options={{ href: null }} />
      </Tabs>
      <QuickCaptureButton />
    </View>
  );
}
