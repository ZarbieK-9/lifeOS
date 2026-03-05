import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus, InteractionManager, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';

import { useColorScheme as useAppColorScheme } from '@/hooks/use-color-scheme';
import { useNetwork } from '@/src/hooks/useNetwork';
import { useStore } from '@/src/store/useStore';
import { useSleep } from '@/src/hooks/useSleep';
import { useFocusTimer } from '@/src/hooks/useFocusTimer';
import { useHydrationReminder } from '@/src/hooks/useHydrationReminder';
import { useProactiveAI } from '@/src/hooks/useProactiveAI';
import { useNotificationListener } from '@/src/hooks/useNotificationListener';

// expo-notifications is not supported in Expo Go (SDK 53+). Only load and use it in dev builds.
const isExpoGo = Constants.appOwnership === 'expo';

export const unstable_settings = {
  anchor: '(tabs)',
};

function AppBoot() {
  const router = useRouter();
  const oauthHandledUrl = useRef<string | null>(null);

  // Handle notification action buttons (Copy Reply, Open App) + default tap
  useEffect(() => {
    if (isExpoGo) return;
    const Notifications = require('expo-notifications');
    const Clipboard = require('expo-clipboard');
    const sub = Notifications.addNotificationResponseReceivedListener((response: {
      actionIdentifier: string;
      notification: { request: { content: { data?: { type?: string; suggestedReply?: string } } } };
    }) => {
      const data = response?.notification?.request?.content?.data;
      if (data?.type !== 'proactive') return;

      const actionId = response.actionIdentifier;
      const reply = typeof data.suggestedReply === 'string' ? data.suggestedReply.trim() : '';

      if (actionId === 'copy_reply' && reply) {
        // Copy Reply button — copy to clipboard, don't open app
        Clipboard.setStringAsync(reply).catch(() => {});
        return;
      }

      // "open_app" action or default tap — copy reply if present, then navigate to AI tab
      if (reply) {
        Clipboard.setStringAsync(reply).catch(() => {});
      }
      InteractionManager.runAfterInteractions(() => {
        try { router.replace('/(tabs)'); } catch (_) {}
      });
    });
    return () => sub.remove();
  }, [router]);

  // Boot hooks — run regardless of which tab the user is on
  useNetwork();
  useSleep();
  useFocusTimer();
  useHydrationReminder();
  useProactiveAI();
  useNotificationListener();

  // Handle Google OAuth deep link when backend redirects to lifeos://oauth?code=...
  // Retry getInitialURL (Android can deliver the intent after a short delay) and re-check when app comes to foreground.
  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!url || !url.startsWith('lifeos://oauth')) return;
      if (oauthHandledUrl.current === url) return;
      oauthHandledUrl.current = url;
      const { googleAuth } = await import('../src/services/google-auth');
      const result = await googleAuth.completeSignInFromDeepLink(url);
      if (result?.success) {
        useStore.getState().setGoogleConnected(true, result.email ?? null);
        InteractionManager.runAfterInteractions(() => {
          try { router.replace('/(tabs)'); } catch (_) {}
        });
      }
    };
    InteractionManager.runAfterInteractions(() => {
      Linking.getInitialURL().then(handleUrl);
    });
    const t1 = setTimeout(() => Linking.getInitialURL().then(handleUrl), 800);
    const t2 = setTimeout(() => Linking.getInitialURL().then(handleUrl), 2000);
    const sub = Linking.addEventListener('url', (e) => handleUrl(e.url));
    const appSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') Linking.getInitialURL().then(handleUrl);
    });
    return () => {
      sub.remove();
      appSub.remove();
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [router]);

  useEffect(() => {
    if (isExpoGo) return;
    const Notifications = require('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    const { requestNotificationPermissions } = require('../src/services/notifications');
    const { registerBackgroundFetch } = require('../src/services/backgroundTasks');
    requestNotificationPermissions();
    registerBackgroundFetch();
  }, []);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const colorScheme = useAppColorScheme();
  const isDark = colorScheme === 'dark';
  const paperTheme = isDark ? MD3DarkTheme : MD3LightTheme;

  return (
    <SafeAreaProvider>
      <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
        <PaperProvider theme={paperTheme}>
          <AppBoot />
          <StatusBar style="auto" />
        </PaperProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
