import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Activity, KeyRound } from 'lucide-react-native';
import { RowCard, ScreenContainer } from '@/src/components/layout';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { kv } from '@/src/db/mmkv';

export default function SystemHealthScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const mqttConnected = kv.getBool('mqtt_connected');

  return (
    <ScreenContainer scroll>
      <View style={ss.header}>
        <Text style={[ss.title, { color: theme.text }]}>System Health</Text>
        <Text style={[ss.sub, { color: theme.textSecondary }]}>
          Diagnostics and technical runtime status.
        </Text>
        <Text style={[ss.badge, { color: mqttConnected ? theme.success : theme.warn }]}>
          MQTT: {mqttConnected ? 'Connected' : 'Disconnected'}
        </Text>
      </View>
      <RowCard
        title="Latency diagnostics"
        subtitle="p50/p95 route, plan, validate, tool, post-process"
        onPress={() => router.push('/settings/latency-diagnostics')}
        left={<Activity size={18} color={theme.primary} strokeWidth={1.8} />}
        variant="outlined"
      />
      <RowCard
        title="API keys"
        subtitle="Tasker, IFTTT, webhooks"
        onPress={() => router.push('/settings/api-keys')}
        left={<KeyRound size={18} color={theme.primary} strokeWidth={1.8} />}
        variant="outlined"
      />
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  header: { marginBottom: 14, gap: 5 },
  title: { fontSize: 28, fontWeight: '700' },
  sub: { fontSize: 14, lineHeight: 20 },
  badge: { fontSize: 13, fontWeight: '600' },
});

