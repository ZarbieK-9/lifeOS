import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, InteractionManager, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from '@/src/store/useStore';
import { kv } from '@/src/db/mmkv';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { Typography } from '@/constants/theme';

const LOGO = require('../assets/images/logo.jpg');

export default function BootstrapScreen() {
  const router = useRouter();
  const init = useStore((s) => s.init);
  const ready = useStore((s) => s.ready);
  const isGoogleConnected = useStore((s) => s.isGoogleConnected);
  const [redirected, setRedirected] = useState(false);
  const mounted = useRef(true);
  const { theme } = useAppTheme();

  useEffect(() => {
    init();
    return () => { mounted.current = false; };
  }, [init]);

  // Defer redirect until after root layout has mounted (avoids "navigate before mounting" error)
  useEffect(() => {
    if (!ready || redirected) return;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!mounted.current || redirected) return;
      setRedirected(true);
      try {
        if (isGoogleConnected) {
          const onboardingDone = kv.getString('onboarding_journey_done') === '1';
          router.replace(onboardingDone ? '/(tabs)' : '/(auth)/journey');
        } else {
          router.replace('/(auth)/landing');
        }
      } catch (_) {
        setRedirected(false);
      }
    });
    return () => task.cancel();
  }, [ready, isGoogleConnected, redirected, router]);

  return (
    <SafeAreaView style={[ss.fill, { backgroundColor: theme.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <Image source={LOGO} style={ss.logo} resizeMode="contain" />
      <ActivityIndicator size="large" color={theme.primary} style={ss.spinner} />
      <Text style={[ss.text, { color: theme.textSecondary }]}>Loading…</Text>
      <Text style={[ss.brand, { color: theme.textSecondary }]}>LifeOS</Text>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  logo: { width: 80, height: 80, marginBottom: 24 },
  spinner: { marginBottom: 12 },
  text: { ...Typography.callout, marginBottom: 8 },
  brand: { ...Typography.caption1 },
});
