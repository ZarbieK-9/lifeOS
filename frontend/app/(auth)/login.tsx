import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, InteractionManager, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { getGoogleRedirectUri } from '@/src/services/google-auth';
import { useStore } from '@/src/store/useStore';
import { kv } from '@/src/db/mmkv';
import { PrimaryButton } from '@/src/components/PrimaryButton';
import { Spacing, Typography } from '@/constants/theme';

export default function LoginScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const setGoogleConnected = useStore((s) => s.setGoogleConnected);
  const isGoogleConnected = useStore((s) => s.isGoogleConnected);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!isGoogleConnected) return;
    const onboardingDone = kv.getString('onboarding_journey_done') === '1';
    router.replace(onboardingDone ? '/(tabs)' : '/(auth)/journey');
  }, [isGoogleConnected, router]);

  const onGoogleSignIn = async () => {
    const redirectUri = getGoogleRedirectUri();
    const isExpoGo = Constants.appOwnership === 'expo';
    if (isExpoGo && redirectUri.startsWith('http')) {
      Alert.alert(
        'Use a development build',
        "Google sign-in with a backend redirect won't work in Expo Go. Build the app with 'eas build' or run a dev client, then try again.",
        [{ text: 'OK' }]
      );
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { googleAuth } = await import('@/src/services/google-auth');
      const result = await googleAuth.signIn();
      if (result.success) {
        setGoogleConnected(true, result.email ?? null);
        InteractionManager.runAfterInteractions(() => {
          try {
            const onboardingDone = kv.getString('onboarding_journey_done') === '1';
            router.replace(onboardingDone ? '/(tabs)' : '/(auth)/journey');
          } catch (_) {}
        });
      } else {
        setError('Sign-in was cancelled. Try again when you\'re ready.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[ss.fill, { backgroundColor: theme.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <View style={[ss.content, { paddingTop: 24, paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity style={ss.back} onPress={() => router.back()}>
          <Text style={[ss.backText, { color: theme.primary }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[ss.title, { color: theme.text }]}>Sign in</Text>
        <Text style={[ss.subtitle, { color: theme.textSecondary }]}>
          Use your Google account to sync calendar, email, and chat history across devices.
        </Text>
        {error != null && (
          <Text style={[ss.error, { color: theme.danger }]}>{error}</Text>
        )}
        <View style={ss.actions}>
          <PrimaryButton
            title="Continue with Google"
            onPress={onGoogleSignIn}
            loading={loading}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  fill: { flex: 1 },
  content: { flex: 1, paddingHorizontal: Spacing.screenPaddingWide },
  back: { alignSelf: 'flex-start', marginBottom: 24 },
  backText: { ...Typography.callout, fontWeight: '600' },
  title: { ...Typography.largeTitle, marginBottom: 8 },
  subtitle: { ...Typography.body, lineHeight: 24, marginBottom: 24 },
  error: { ...Typography.footnote, marginBottom: 16 },
  actions: { marginTop: 8 },
});
