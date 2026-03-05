// Catches lifeos://oauth?code=... or lifeos://oauth?state=... deep link so Expo Router doesn't show "unmatched route".
// Root _layout.tsx handles the actual OAuth completion via getInitialURL / Linking.
// This screen just shows loading and redirects to the app.

import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export default function OAuthCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => {
      router.replace('/(tabs)');
    }, 1500);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
      <Text style={styles.text}>Completing sign-in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  text: {
    fontSize: 16,
  },
});
