import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { useHaptics } from '@/src/hooks/useHaptics';
import { ScreenContainer, Section, ScreenHeader } from '@/src/components/layout';
import { Card } from '@/src/components/Card';
import { exportBackup, importBackup } from '@/src/services/backup';

export default function SettingsAboutScreen() {
  const { theme } = useAppTheme();
  const haptic = useHaptics();
  const [loading, setLoading] = useState(false);

  const onBackup = async () => {
    haptic.light();
    setLoading(true);
    try {
      await exportBackup();
    } catch (e) {
      Alert.alert('Backup failed', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onRestore = () => {
    haptic.light();
    Alert.alert(
      'Restore backup',
      'This will replace all current data with the backup. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const result = await importBackup();
              Alert.alert(result.ok ? 'Success' : 'Error', result.message);
            } catch (e) {
              Alert.alert('Restore failed', (e as Error).message);
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  return (
    <ScreenContainer scroll header={<ScreenHeader title="About" />}>
      <Section title="LifeOS">
        <Card variant="outlined">
          <Text style={[ss.label, { color: theme.text }]}>LifeOS v1.0.0</Text>
          <Text style={[ss.hint, { color: theme.textSecondary }]}>Self-hosted, offline-first personal automation</Text>
        </Card>
      </Section>

      <Section title="Backup & restore">
        <Card variant="outlined">
          <View style={ss.btnRow}>
            <TouchableOpacity style={[ss.btn, { backgroundColor: theme.primary }]} onPress={onBackup}>
              <Text style={ss.btnText}>Backup</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[ss.btn, { backgroundColor: theme.textSecondary }]} onPress={onRestore}>
              <Text style={ss.btnText}>Restore</Text>
            </TouchableOpacity>
          </View>
          {loading && <ActivityIndicator style={{ marginTop: 8 }} color={theme.primary} />}
          <Text style={[ss.hint, { color: theme.textSecondary }]}>Exports SQLite database and MMKV cache locally</Text>
        </Card>
      </Section>
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  label: { fontSize: 16, fontWeight: '500' },
  hint: { fontSize: 13, marginTop: 4 },
  btnRow: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
