import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus, InteractionManager, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';

import { useNetwork } from '@/src/hooks/useNetwork';
import { useStore } from '@/src/store/useStore';
import { useSleep } from '@/src/hooks/useSleep';
import { useFocusTimer } from '@/src/hooks/useFocusTimer';
import { useHydrationReminder } from '@/src/hooks/useHydrationReminder';
import { useProactiveAI } from '@/src/hooks/useProactiveAI';
import { useNotificationListener } from '@/src/hooks/useNotificationListener';
import { initAgentSystem, onAppForeground } from '@/src/agent/agent';
import {
  consumePendingHeyZarbieCommand,
  registerHeyZarbieListeners,
  syncHeyZarbieState,
} from '@/src/services/heyZarbie';
import { ThemeContextProvider, useThemeContext } from '@/src/context/ThemeContext';

// expo-notifications is not supported in Expo Go (SDK 53+). Only load and use it in dev builds.
const isExpoGo = Constants.appOwnership === 'expo';

export const unstable_settings = {
  anchor: '(tabs)',
};

async function registerPushTokenWithRetry(maxRetries = 3): Promise<void> {
  const { api } = await import('../src/services/api');
  if (!api.isConfigured() || !(await api.isAuthenticated())) return;

  const Notifications = require('expo-notifications');
  const ExpoConstants = require('expo-constants');
  const Device = require('expo-device');
  const { kv } = require('../src/db/mmkv');

  const projectId = ExpoConstants.expoConfig?.extra?.eas?.projectId;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const tokenRes = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
      const token = tokenRes?.data;
      if (!token) throw new Error('No token returned');

      const result = await api.registerPushToken({
        token,
        platform: Device.osName?.toLowerCase().includes('ios') ? 'ios' : 'android',
        device_id: Device.modelId || Device.modelName || undefined,
      });

      if (result.ok) {
        kv.set('push_token', token);
        kv.set('push_token_registered_at', new Date().toISOString());
        console.log('[LifeOS] Push token registered successfully');
        return;
      }
      throw new Error(result.error || 'Registration failed');
    } catch (e) {
      console.warn(`[LifeOS] Push register attempt ${attempt + 1} failed:`, e);
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }
}

function AppBoot() {
  const router = useRouter();
  const oauthHandledUrl = useRef<string | null>(null);
  const addAiCommand = useStore((s) => s.addAiCommand);
  const resolveAiCommand = useStore((s) => s.resolveAiCommand);
  const heyZarbieEnabled = useStore((s) => s.heyZarbieEnabled);
  const heyZarbieOnlyWhenCharging = useStore((s) => s.heyZarbieOnlyWhenCharging);
  const heyZarbiePauseOnLowBattery = useStore((s) => s.heyZarbiePauseOnLowBattery);
  const heyZarbieSensitivity = useStore((s) => s.heyZarbieSensitivity);
  const heyZarbieLaunchBehavior = useStore((s) => s.heyZarbieLaunchBehavior);
  const heyZarbieConsentGranted = useStore((s) => s.heyZarbieConsentGranted);

  const processHeyZarbieTranscript = useCallback(
    async (raw: string) => {
      const command = (raw || '').trim();
      if (!command) return;
      const { runVoiceCommand } = await import('../src/agent/agent');
      useStore.getState().enqueueEvent('agent_outcome', {
        source: 'heyzarbie',
        phase: 'transcript_received',
        text_len: command.length,
      }).catch(() => {});
      const cmdId = await addAiCommand(command, 'voice');
      try {
        const response = await runVoiceCommand(command, { handsFree: true, cmdId });
        await resolveAiCommand(cmdId, response.output, 'executed');
        useStore.getState().enqueueEvent('agent_outcome', {
          source: 'heyzarbie',
          phase: 'command_executed',
          cmd_id: cmdId,
        }).catch(() => {});
        InteractionManager.runAfterInteractions(() => {
          try {
            router.push('/(tabs)/ai');
          } catch (_) {}
        });
      } catch {
        await resolveAiCommand(cmdId, `Error processing command: "${command}"`, 'failed');
        useStore.getState().enqueueEvent('agent_outcome', {
          source: 'heyzarbie',
          phase: 'command_failed',
          cmd_id: cmdId,
        }).catch(() => {});
      }
    },
    [addAiCommand, resolveAiCommand, router],
  );

  useEffect(() => {
    const drainPending = () => {
      void (async () => {
        const pending = await consumePendingHeyZarbieCommand();
        if (pending) await processHeyZarbieTranscript(pending);
      })();
    };
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') drainPending();
    });
    const t = setTimeout(drainPending, 1000);
    return () => {
      sub.remove();
      clearTimeout(t);
    };
  }, [processHeyZarbieTranscript]);

  // Handle notification action buttons (Copy Reply, Open App) + default tap
  useEffect(() => {
    const unsub = registerHeyZarbieListeners({
      onTranscript: ({ text }) => {
        void processHeyZarbieTranscript(text || '');
      },
      onWakeDetected: () => {
        useStore.getState().enqueueEvent('agent_outcome', {
          source: 'heyzarbie',
          phase: 'wake_detected',
        }).catch(() => {});
      },
      onWakeError: ({ reason }) => {
        useStore.getState().enqueueEvent('agent_outcome', {
          source: 'heyzarbie',
          phase: 'wake_error',
          reason: reason ?? 'unknown',
        }).catch(() => {});
      },
    });
    return () => unsub();
  }, [processHeyZarbieTranscript]);

  useEffect(() => {
    const enabled = heyZarbieConsentGranted && heyZarbieEnabled;
    syncHeyZarbieState({
      enabled,
      onlyWhenCharging: heyZarbieOnlyWhenCharging,
      pauseOnLowBattery: heyZarbiePauseOnLowBattery,
      sensitivity: heyZarbieSensitivity,
      launchBehavior: heyZarbieLaunchBehavior,
    }).catch(() => {});
  }, [
    heyZarbieEnabled,
    heyZarbieOnlyWhenCharging,
    heyZarbiePauseOnLowBattery,
    heyZarbieSensitivity,
    heyZarbieLaunchBehavior,
    heyZarbieConsentGranted,
  ]);

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

  // Initialize the agentic system (watcher, patterns, domain agents, goals, plans)
  useEffect(() => {
    const notifyFn = isExpoGo
      ? undefined
      : (title: string, body: string, _priority: 'high' | 'low') => {
          import('../src/services/notifications').then(({ sendProactiveNotification }) => {
            sendProactiveNotification(title, body).catch(() => {});
          });
        };
    initAgentSystem(notifyFn).catch((e) => console.warn('[AppBoot] agent init error:', e));

    // Evaluate watcher on app foreground
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') onAppForeground();
    });
    return () => sub.remove();
  }, []);

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
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    const { requestNotificationPermissions } = require('../src/services/notifications');
    const { registerBackgroundFetch } = require('../src/services/backgroundTasks');
    const {
      registerScheduledCoachNotifications,
      cancelScheduledCoachNotifications,
    } = require('../src/services/scheduledCoachNotifications');
    const { kv } = require('../src/db/mmkv');
    requestNotificationPermissions().then(async (granted: boolean) => {
      if (granted) {
        if (kv.getString('server_coach_enabled') === '1') {
          await cancelScheduledCoachNotifications();
        } else {
          await registerScheduledCoachNotifications();
        }
      }
      if (granted) {
        registerPushTokenWithRetry().catch((e) =>
          console.warn('[LifeOS] Push token registration failed:', e),
        );
      }
    });

    // Foreground remote push handler
    const foregroundSub = Notifications.addNotificationReceivedListener(
      (notification: { request?: { content?: { data?: Record<string, unknown> } } }) => {
        const data = notification.request?.content?.data;
        const type = data?.type;
        console.log('[LifeOS] Foreground push received:', type);
        if (type === 'coach' || type === 'watcher') {
          import('../src/store/useStore')
            .then(({ useStore }) => useStore.getState().loadWatcherQueue())
            .catch(() => {});
        }
      },
    );

    registerBackgroundFetch();
    return () => { foregroundSub.remove(); };
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

// ── Error Boundary ────────────────────────────────

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[AppErrorBoundary] Uncaught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: '#000' }}>
          <Text style={{ color: '#ff6b6b', fontSize: 18, fontWeight: '700', marginBottom: 12 }}>Something went wrong</Text>
          <Text style={{ color: '#aaa', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </Text>
          <Text
            style={{ color: '#5a8f86', fontSize: 16, fontWeight: '600' }}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            Try Again
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <ThemeContextProvider>
        <RootThemeShell />
      </ThemeContextProvider>
    </AppErrorBoundary>
  );
}

function RootThemeShell() {
  const { resolvedMode } = useThemeContext();
  const isDark = resolvedMode === 'dark';
  const paperTheme = isDark ? MD3DarkTheme : MD3LightTheme;

  return (
    <SafeAreaProvider>
      <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
        <PaperProvider theme={paperTheme}>
          <AppBoot />
          <StatusBar style={isDark ? 'light' : 'dark'} />
        </PaperProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
