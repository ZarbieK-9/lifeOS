import { useRouter } from 'expo-router';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { PrimaryButton } from '@/src/components/PrimaryButton';
import { Typography, Spacing } from '@/constants/theme';

const LOGO = require('../../assets/images/logo.jpg');

export default function LandingScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <SafeAreaView style={[ss.fill, { backgroundColor: theme.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <View style={[ss.content, { paddingTop: 24, paddingBottom: insets.bottom + 24 }]}>
        <View style={ss.hero}>
          <Image source={LOGO} style={ss.logo} resizeMode="contain" />
          <Text style={[ss.title, { color: theme.text }]}>LifeOS</Text>
          <Text style={[ss.subtitle, { color: theme.textSecondary }]}>
            Your personal AI for tasks, health, and day planning. One place to stay on top of life.
          </Text>
        </View>
        <View style={ss.features}>
          <Text style={[ss.feature, { color: theme.textSecondary }]}>Chat with PicoClaw — plan your day, log water, manage tasks</Text>
          <Text style={[ss.feature, { color: theme.textSecondary }]}>Calendar & email in one place</Text>
          <Text style={[ss.feature, { color: theme.textSecondary }]}>Offline-first, your data stays with you</Text>
        </View>
        <View style={ss.actions}>
          <PrimaryButton
            title="Get started with Google"
            onPress={() => router.push('/(auth)/login')}
          />
          <Text style={[ss.hint, { color: theme.textSecondary }]}>
            Sign in to sync across devices and unlock calendar and email.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  fill: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.screenPaddingWide,
    justifyContent: 'space-between',
  },
  hero: { alignItems: 'center', marginBottom: 32 },
  logo: { width: 72, height: 72, marginBottom: 16 },
  title: { ...Typography.largeTitle, marginBottom: 12, textAlign: 'center' },
  subtitle: { ...Typography.body, lineHeight: 24, textAlign: 'center', maxWidth: 320 },
  features: { gap: 12, marginBottom: 32 },
  feature: { ...Typography.callout },
  actions: { gap: 16 },
  hint: { ...Typography.footnote, textAlign: 'center' },
});
