import Constants from 'expo-constants';
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useStore } from '@/src/store/useStore';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { useHaptics } from '@/src/hooks/useHaptics';
import { getGoogleRedirectUri } from '@/src/services/google-auth';
import { ScreenContainer, Section, ScreenHeader } from '@/src/components/layout';
import { Card } from '@/src/components/Card';

export default function SettingsGoogleScreen() {
  const { theme } = useAppTheme();
  const haptic = useHaptics();
  const isGoogleConnected = useStore((s) => s.isGoogleConnected);
  const googleEmail = useStore((s) => s.googleEmail);
  const lastCalendarError = useStore((s) => s.lastCalendarError);
  const lastEmailError = useStore((s) => s.lastEmailError);
  const setGoogleConnected = useStore((s) => s.setGoogleConnected);

  const [googleLoading, setGoogleLoading] = useState(false);

  const onConnectGoogle = async () => {
    haptic.light();
    Alert.alert(
      'Sign in with Google',
      "You'll open your browser to sign in. After you sign in, if you see a \"Visit Site\" or ngrok page, tap it once—then you'll return to the app.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            const redirectUri = getGoogleRedirectUri();
            const isExpoGo = Constants.appOwnership === 'expo';
            if (isExpoGo && redirectUri.startsWith('http')) {
              Alert.alert(
                'Use a development build',
                "Google sign-in with your backend redirect won't work in Expo Go—the app's link (lifeos://) isn't registered there. Build the app with 'eas build' or run a dev client, then try again.",
                [{ text: 'OK' }]
              );
              return;
            }
            setGoogleLoading(true);
            try {
              const { googleAuth } = await import('@/src/services/google-auth');
              const result = await googleAuth.signIn();
              if (result.success) {
                setGoogleConnected(true, result.email ?? null);
                haptic.success();
                Alert.alert('Connected', `Google account connected${result.email ? ` (${result.email})` : ''}`);
              } else {
                haptic.error();
                Alert.alert('Failed', 'Google sign-in was cancelled or failed.');
              }
            } catch (e) {
              haptic.error();
              Alert.alert('Error', (e as Error).message);
            }
            setGoogleLoading(false);
          },
        },
      ]
    );
  };

  const onDisconnectGoogle = () => {
    Alert.alert('Disconnect Google', 'Remove Google Calendar and Gmail access?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          haptic.warning();
          const { googleAuth } = await import('@/src/services/google-auth');
          await googleAuth.disconnect();
          setGoogleConnected(false, null);
        },
      },
    ]);
  };

  return (
    <ScreenContainer scroll header={<ScreenHeader title="Google" />}>
      <Section title="Account" description="Sync calendar, email, and chat across devices.">
        <Card variant="outlined">
          {isGoogleConnected ? (
            <>
              <View style={ss.row}>
                <Text style={[ss.label, { color: theme.text }]}>{googleEmail ?? 'Google connected'}</Text>
                <View style={[ss.dot, { backgroundColor: theme.success }]} />
              </View>
              {(lastCalendarError || lastEmailError) && (
                <Text style={[ss.hint, { color: theme.warn, fontSize: 12, marginTop: 8 }]}>
                  {lastCalendarError || lastEmailError}. Enable Calendar & Gmail APIs in Google Cloud if needed.
                </Text>
              )}
              <TouchableOpacity style={[ss.btn, { backgroundColor: theme.danger }, { marginTop: 12 }]} onPress={onDisconnectGoogle}>
                <Text style={ss.btnText}>Disconnect</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={[ss.hint, { color: theme.textSecondary }]}>Sign in to sync calendar, email, and chat across devices.</Text>
              <TouchableOpacity
                style={[ss.btn, { backgroundColor: theme.primary }, { marginTop: 12 }]}
                onPress={onConnectGoogle}
                disabled={googleLoading}
              >
                {googleLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={ss.btnText}>Sign in with Google</Text>}
              </TouchableOpacity>
              {__DEV__ && (
                <TouchableOpacity
                  style={[ss.chipBtn, { backgroundColor: theme.primaryBg, marginTop: 8 }]}
                  onPress={async () => {
                    await Clipboard.setStringAsync(getGoogleRedirectUri());
                    haptic.light();
                    Alert.alert('Redirect URI copied', 'Add it in Google Cloud Console → Credentials → your OAuth client → Authorized redirect URIs.');
                  }}
                >
                  <Text style={[ss.chipBtnText, { color: theme.primary }]}>Copy redirect URI</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </Card>
      </Section>
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 16, fontWeight: '500' },
  hint: { fontSize: 13 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  btn: { alignItems: 'center', paddingVertical: 12, borderRadius: 12 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  chipBtn: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  chipBtnText: { fontSize: 13, fontWeight: '600' },
});
