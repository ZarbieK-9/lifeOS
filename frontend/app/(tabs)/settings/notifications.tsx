import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, Platform } from 'react-native';
import { useStore } from '@/src/store/useStore';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { useHaptics } from '@/src/hooks/useHaptics';
import { ScreenContainer, Section, ScreenHeader } from '@/src/components/layout';
import { Card } from '@/src/components/Card';

export default function SettingsNotificationsScreen() {
  const { theme } = useAppTheme();
  const haptic = useHaptics();
  const checkinIntervalMin = useStore((s) => s.checkinIntervalMin);
  const setCheckinIntervalMin = useStore((s) => s.setCheckinIntervalMin);
  const proactiveQuietAfterHour = useStore((s) => s.proactiveQuietAfterHour);
  const proactiveQuietBeforeHour = useStore((s) => s.proactiveQuietBeforeHour);
  const setProactiveQuietHours = useStore((s) => s.setProactiveQuietHours);
  const seenNotifPackages = useStore((s) => s.seenNotifPackages);
  const allowedNotifPackages = useStore((s) => s.allowedNotifPackages);
  const setAllowedNotifPackages = useStore((s) => s.setAllowedNotifPackages);
  const autoMorningEnabled = useStore((s) => s.autoMorningEnabled);
  const autoNightEnabled = useStore((s) => s.autoNightEnabled);
  const setAutoMorning = useStore((s) => s.setAutoMorning);
  const setAutoNight = useStore((s) => s.setAutoNight);

  const onToggleAppPackage = (packageName: string, enabled: boolean) => {
    haptic.light();
    let current = [...allowedNotifPackages];
    if (current.length === 0) current = seenNotifPackages.map((p) => p.packageName);
    if (enabled) {
      if (!current.includes(packageName)) current.push(packageName);
    } else {
      current = current.filter((p) => p !== packageName);
    }
    const allSeen = seenNotifPackages.map((p) => p.packageName);
    const allEnabled = allSeen.every((p) => current.includes(p));
    setAllowedNotifPackages(allEnabled ? [] : current);
  };

  return (
    <ScreenContainer scroll header={<ScreenHeader title="Proactive AI & notifications" />}>
      <Section title="PicoClaw AI" description="Check-ins and briefings (always on).">
        <Card variant="outlined">
          <View style={[ss.row, { borderBottomWidth: 1, borderColor: theme.border, paddingBottom: 10 }]}>
            <Text style={[ss.label, { color: theme.text }]}>Check-in interval</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[60, 90, 120].map((min) => (
                <TouchableOpacity
                  key={min}
                  onPress={() => { haptic.light(); setCheckinIntervalMin(min); }}
                  style={[ss.chip, checkinIntervalMin === min ? { backgroundColor: theme.primary } : { backgroundColor: theme.border }]}
                >
                  <Text style={{ color: checkinIntervalMin === min ? '#fff' : theme.text, fontWeight: '600' }}>{min}m</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <Text style={[ss.hint, { color: theme.textSecondary }]}>How often to nudge (60, 90, or 120 min)</Text>

          <View style={[ss.row, { marginTop: 12, borderBottomWidth: 1, borderColor: theme.border, paddingBottom: 10 }]}>
            <Text style={[ss.label, { color: theme.text }]}>Quiet hours</Text>
            <Text style={[ss.hint, { color: theme.textSecondary }]}>
              No check-ins after {proactiveQuietAfterHour}:00 or before {proactiveQuietBeforeHour}:00
            </Text>
          </View>
          <View style={ss.chipRow}>
            <TouchableOpacity
              onPress={() => { haptic.light(); setProactiveQuietHours(21, 7); }}
              style={[ss.chip, (proactiveQuietAfterHour === 21 && proactiveQuietBeforeHour === 7) ? { backgroundColor: theme.primary } : { backgroundColor: theme.border }]}
            >
              <Text style={{ color: (proactiveQuietAfterHour === 21 && proactiveQuietBeforeHour === 7) ? '#fff' : theme.text, fontWeight: '600' }}>21:00–07:00</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { haptic.light(); setProactiveQuietHours(22, 6); }}
              style={[ss.chip, (proactiveQuietAfterHour === 22 && proactiveQuietBeforeHour === 6) ? { backgroundColor: theme.primary } : { backgroundColor: theme.border }]}
            >
              <Text style={{ color: (proactiveQuietAfterHour === 22 && proactiveQuietBeforeHour === 6) ? '#fff' : theme.text, fontWeight: '600' }}>22:00–06:00</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { haptic.light(); setProactiveQuietHours(0, 0); }}
              style={[ss.chip, (proactiveQuietAfterHour === 0 && proactiveQuietBeforeHour === 0) ? { backgroundColor: theme.primary } : { backgroundColor: theme.border }]}
            >
              <Text style={{ color: (proactiveQuietAfterHour === 0 && proactiveQuietBeforeHour === 0) ? '#fff' : theme.text, fontWeight: '600' }}>Off</Text>
            </TouchableOpacity>
          </View>
        </Card>
      </Section>

      <Section title="Sleep routines">
        <Card variant="outlined">
          <View style={ss.row}>
            <Text style={[ss.label, { color: theme.text }]}>Morning Summary</Text>
            <Switch value={autoMorningEnabled} onValueChange={(v) => { haptic.light(); setAutoMorning(v); }} trackColor={{ false: theme.border, true: theme.primary }} />
          </View>
          <Text style={[ss.hint, { color: theme.textSecondary }]}>Auto-send day preview when wake is detected</Text>
          <View style={[ss.row, { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderColor: theme.border }]}>
            <Text style={[ss.label, { color: theme.text }]}>Night Summary</Text>
            <Switch value={autoNightEnabled} onValueChange={(v) => { haptic.light(); setAutoNight(v); }} trackColor={{ false: theme.border, true: theme.primary }} />
          </View>
          <Text style={[ss.hint, { color: theme.textSecondary }]}>Auto-send day review when sleep is detected</Text>
        </Card>
      </Section>

      {Platform.OS === 'android' && seenNotifPackages.length > 0 && (
        <Section title="Notification filter" description={allowedNotifPackages.length === 0 ? 'Listening to all apps.' : `Listening to ${allowedNotifPackages.length} of ${seenNotifPackages.length} apps.`}>
          <Card variant="outlined">
            {seenNotifPackages.map((pkg) => {
              const isAllowed = allowedNotifPackages.length === 0 || allowedNotifPackages.includes(pkg.packageName);
              return (
                <View key={pkg.packageName} style={[ss.row, { borderTopWidth: 1, borderColor: theme.border, paddingTop: 8 }]}>
                  <Text style={[ss.label, { color: theme.text, flex: 1 }]} numberOfLines={1}>{pkg.appName}</Text>
                  <Switch value={isAllowed} onValueChange={(v) => onToggleAppPackage(pkg.packageName, v)} trackColor={{ false: theme.border, true: theme.primary }} />
                </View>
              );
            })}
          </Card>
        </Section>
      )}
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 16, fontWeight: '500' },
  hint: { fontSize: 13, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
});
