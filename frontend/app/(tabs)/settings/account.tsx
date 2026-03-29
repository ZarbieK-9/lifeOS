import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useStore } from '@/src/store/useStore';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { useHaptics } from '@/src/hooks/useHaptics';
import { ScreenContainer, Section, ScreenHeader } from '@/src/components/layout';
import { Card } from '@/src/components/Card';
import { api } from '@/src/services/api';
import { kv } from '@/src/db/mmkv';
import dayjs from 'dayjs';
import { Alert } from 'react-native';

export default function SettingsAccountScreen() {
  const { theme } = useAppTheme();
  const haptic = useHaptics();
  const isOnline = useStore((s) => s.isOnline);
  const queueCount = useStore((s) => s.queueCount);
  const queuedEvents = useStore((s) => s.queuedEvents);
  const drainQueue = useStore((s) => s.drainQueue);
  const loadQueue = useStore((s) => s.loadQueue);
  const init = useStore((s) => s.init);

  const [connectionStatus, setConnectionStatus] = useState<'untested' | 'connected' | 'error'>('untested');

  useEffect(() => {
    init();
    loadQueue();
  }, [init, loadQueue]);

  useEffect(() => {
    api.health().then((r) => setConnectionStatus(r.ok ? 'connected' : 'error'));
  }, []);

  const mqttConnected = kv.getBool('mqtt_connected');

  const onSync = async () => {
    haptic.medium();
    if (!isOnline) {
      Alert.alert('Offline', 'Connect to a network to sync queued events.');
      return;
    }
    await drainQueue();
    haptic.success();
    Alert.alert('Synced', 'All queued events have been processed.');
  };

  const onClearQueue = () => {
    Alert.alert('Clear Queue', 'Remove all pending events?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => { haptic.warning(); await drainQueue(); } },
    ]);
  };

  return (
    <ScreenContainer scroll header={<ScreenHeader title="Account & connection" />}>
      <Section title="Connection">
        <Card variant="outlined">
          <View style={ss.row}>
            <Text style={[ss.label, { color: theme.text }]}>Network</Text>
            <View style={ss.statusRow}>
              <View style={[ss.dot, { backgroundColor: isOnline ? theme.success : theme.warn }]} />
              <Text style={[ss.hint, { color: theme.textSecondary }]}>{isOnline ? 'Online' : 'Offline'}</Text>
            </View>
          </View>
          <View style={[ss.row, ss.rowBorder, { borderColor: theme.border }]}>
            <Text style={[ss.label, { color: theme.text }]}>Backend</Text>
            <Text style={[ss.hint, { color: theme.textSecondary }]} numberOfLines={1}>{api.getBaseUrl() || 'Not set'}</Text>
          </View>
          <View style={[ss.statusBar, { backgroundColor: connectionStatus === 'connected' ? theme.successBg : connectionStatus === 'error' ? theme.dangerBg : theme.warnBg }]}>
            <View style={[ss.dot, { backgroundColor: connectionStatus === 'connected' ? theme.success : connectionStatus === 'error' ? theme.danger : theme.warn }]} />
            <Text style={[ss.statusText, { color: connectionStatus === 'connected' ? theme.success : connectionStatus === 'error' ? theme.danger : theme.warn }]}>
              {connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'error' ? 'Unreachable' : 'Checking…'}
            </Text>
          </View>
          {mqttConnected && (
            <View style={[ss.statusBar, { backgroundColor: theme.successBg }]}>
              <View style={[ss.dot, { backgroundColor: theme.success }]} />
              <Text style={[ss.statusText, { color: theme.success }]}>MQTT connected</Text>
            </View>
          )}
        </Card>
      </Section>

      <Section title="Offline queue">
        <Card variant="outlined">
          <View style={ss.row}>
            <Text style={[ss.label, { color: theme.text }]}>Pending</Text>
            <View style={[ss.badge, { backgroundColor: queueCount > 0 ? theme.warn : theme.success }]}>
              <Text style={ss.badgeText}>{queueCount}</Text>
            </View>
          </View>
          {queuedEvents.slice(0, 5).map((e) => (
            <View key={e.id} style={[ss.queueItem, { borderColor: theme.border }]}>
              <View style={[ss.typeBadge, { backgroundColor: theme.primaryBg }]}>
                <Text style={[ss.typeText, { color: theme.primary }]}>{e.type}</Text>
              </View>
              <Text style={[ss.hint, { color: theme.textSecondary }]}>{dayjs(e.created_at).format('HH:mm')}</Text>
            </View>
          ))}
          <View style={ss.btnRow}>
            <TouchableOpacity style={[ss.btn, { backgroundColor: theme.primary }]} onPress={onSync}>
              <Text style={ss.btnText}>Sync now</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[ss.btn, { backgroundColor: theme.danger }]} onPress={onClearQueue}>
              <Text style={ss.btnText}>Clear</Text>
            </TouchableOpacity>
          </View>
        </Card>
      </Section>
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  rowBorder: { borderTopWidth: 1, paddingTop: 10 },
  label: { fontSize: 16, fontWeight: '500' },
  hint: { fontSize: 13 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusBar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, marginTop: 8 },
  statusText: { fontSize: 14, fontWeight: '600' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  badgeText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  queueItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, paddingTop: 8, marginTop: 4 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  typeText: { fontSize: 12, fontWeight: '600' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
