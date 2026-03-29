import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import dayjs from 'dayjs';
import { useStore } from '@/src/store/useStore';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { useHaptics } from '@/src/hooks/useHaptics';
import { ScreenContainer, Section, ScreenHeader } from '@/src/components/layout';
import { Card } from '@/src/components/Card';

function formatHour(h: number) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12} ${ampm}`;
}

function formatInterval(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}min`;
}

export default function SettingsHydrationScreen() {
  const { theme } = useAppTheme();
  const haptic = useHaptics();
  const hydrationReminderEnabled = useStore((s) => s.hydrationReminderEnabled);
  const hydrationStartHour = useStore((s) => s.hydrationStartHour);
  const hydrationEndHour = useStore((s) => s.hydrationEndHour);
  const hydrationGoalMl = useStore((s) => s.hydrationGoalMl);
  const hydrationIntervalMin = useStore((s) => s.hydrationIntervalMin);
  const hydrationDosePerReminder = useStore((s) => s.hydrationDosePerReminder);
  const nextHydrationReminderAt = useStore((s) => s.nextHydrationReminderAt);
  const setHydrationReminder = useStore((s) => s.setHydrationReminder);
  const disableHydrationReminder = useStore((s) => s.disableHydrationReminder);

  const onToggle = (v: boolean) => {
    haptic.light();
    if (v) setHydrationReminder(hydrationStartHour, hydrationEndHour, hydrationGoalMl);
    else disableHydrationReminder();
  };
  const onSetGoal = (ml: number) => { haptic.light(); setHydrationReminder(hydrationStartHour, hydrationEndHour, ml); };
  const onSetStart = (hour: number) => { haptic.light(); if (hour < hydrationEndHour) setHydrationReminder(hour, hydrationEndHour, hydrationGoalMl); };
  const onSetEnd = (hour: number) => { haptic.light(); if (hour > hydrationStartHour) setHydrationReminder(hydrationStartHour, hour, hydrationGoalMl); };

  return (
    <ScreenContainer scroll header={<ScreenHeader title="Hydration reminders" />}>
      <Section title="Reminders" description="Pauses during focus mode.">
        <Card variant="outlined">
          <View style={ss.row}>
            <Text style={[ss.label, { color: theme.text }]}>Hydration Reminders</Text>
            <Switch value={hydrationReminderEnabled} onValueChange={onToggle} trackColor={{ false: theme.border, true: theme.primary }} />
          </View>

          {hydrationReminderEnabled && (
            <>
              <Text style={[ss.hint, { color: theme.textSecondary }, { marginTop: 12 }]}>Start Time</Text>
              <View style={ss.chipRow}>
                {[6, 7, 8, 9, 10].map((h) => (
                  <TouchableOpacity key={`start-${h}`} style={[ss.chip, { backgroundColor: hydrationStartHour === h ? theme.primary : theme.primaryBg }]} onPress={() => onSetStart(h)}>
                    <Text style={[ss.chipText, { color: hydrationStartHour === h ? '#fff' : theme.primary }]}>{formatHour(h)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[ss.hint, { color: theme.textSecondary }, { marginTop: 8 }]}>End Time</Text>
              <View style={ss.chipRow}>
                {[20, 21, 22, 23].map((h) => (
                  <TouchableOpacity key={`end-${h}`} style={[ss.chip, { backgroundColor: hydrationEndHour === h ? theme.primary : theme.primaryBg }]} onPress={() => onSetEnd(h)}>
                    <Text style={[ss.chipText, { color: hydrationEndHour === h ? '#fff' : theme.primary }]}>{formatHour(h)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[ss.hint, { color: theme.textSecondary }, { marginTop: 8 }]}>Daily Goal</Text>
              <View style={ss.chipRow}>
                {[1500, 2000, 2500, 3000].map((ml) => (
                  <TouchableOpacity key={`goal-${ml}`} style={[ss.chip, { backgroundColor: hydrationGoalMl === ml ? theme.primary : theme.primaryBg }]} onPress={() => onSetGoal(ml)}>
                    <Text style={[ss.chipText, { color: hydrationGoalMl === ml ? '#fff' : theme.primary }]}>{ml / 1000}L</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={[ss.statusBar, { backgroundColor: theme.primaryBg }, { marginTop: 12 }]}>
                <Text style={[ss.statusText, { color: theme.primary }]}>Every {formatInterval(hydrationIntervalMin)} · ~{hydrationDosePerReminder}ml per reminder</Text>
              </View>
              {nextHydrationReminderAt && (
                <Text style={[ss.hint, { color: theme.textSecondary }, { marginTop: 8 }]}>Next: {dayjs(nextHydrationReminderAt).format('h:mm A')}</Text>
              )}
            </>
          )}
        </Card>
      </Section>
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 16, fontWeight: '500' },
  hint: { fontSize: 13 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  chipText: { fontSize: 13, fontWeight: '600' },
  statusBar: { padding: 12, borderRadius: 12 },
  statusText: { fontSize: 14, fontWeight: '600' },
});
