import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { EmptyMood } from '@/src/components/illustrations';
import dayjs from 'dayjs';
import { useStore } from '@/src/store/useStore';
import { useHaptics } from '@/src/hooks/useHaptics';
import { PressableScale } from '@/components/PressableScale';
import { ScreenContainer, Section, ScreenHeader } from '@/src/components/layout';
import { Card } from '@/src/components/Card';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { Typography } from '@/constants/theme';

const MOOD_EMOJI = ['', '😞', '😐', '🙂', '😊', '🤩'];
const ENERGY_EMOJI = ['', '🪫', '😴', '⚡', '🔋', '⚡⚡'];

export default function MoodScreen() {
  const { theme } = useAppTheme();
  const haptic = useHaptics();
  const moodLogs = useStore((s) => s.moodLogs);
  const addMoodLog = useStore((s) => s.addMoodLog);

  const [moodPending, setMoodPending] = useState<number | null>(null);

  const todayStr = dayjs().format('YYYY-MM-DD');
  const todayMood = moodLogs.find((l) => l.logged_at.startsWith(todayStr));

  const onSelectMood = useCallback(
    (mood: number) => {
      haptic.light();
      setMoodPending(mood);
    },
    [haptic]
  );

  const onSelectEnergy = useCallback(
    async (energy: number) => {
      if (moodPending == null) return;
      haptic.success();
      await addMoodLog(moodPending, energy);
      setMoodPending(null);
    },
    [moodPending, addMoodLog, haptic]
  );

  return (
    <ScreenContainer scroll header={<ScreenHeader title="Mood & energy" />}>
      <Section
        title="How are you feeling?"
        description="Log your mood and energy for today."
      >
        {todayMood ? (
          <Card variant="elevated">
            <View style={ss.row}>
              <Text style={{ fontSize: 28 }}>
                {MOOD_EMOJI[todayMood.mood]}
              </Text>
              <Text style={[ss.big, { color: theme.warn }]}>
                {todayMood.mood}/5
              </Text>
              <Text style={[ss.meta, { color: theme.textSecondary }]}>
                mood
              </Text>
              <Text style={{ fontSize: 28, marginLeft: 12 }}>
                {ENERGY_EMOJI[todayMood.energy]}
              </Text>
              <Text style={[ss.big, { color: theme.primary }]}>
                {todayMood.energy}/5
              </Text>
              <Text style={[ss.meta, { color: theme.textSecondary }]}>
                energy
              </Text>
            </View>
            {todayMood.note ? (
              <Text
                style={[ss.meta, { color: theme.textSecondary }, { marginTop: 8 }]}
              >
                {todayMood.note}
              </Text>
            ) : null}
          </Card>
        ) : moodPending !== null ? (
          <Card variant="outlined">
            <Text style={[ss.meta, { color: theme.textSecondary }]}>
              Mood: {MOOD_EMOJI[moodPending]} — now tap energy:
            </Text>
            <View style={[ss.row, { marginTop: 12 }]}>
              {[1, 2, 3, 4, 5].map((e) => (
                <PressableScale
                  key={e}
                  style={[ss.chip, { backgroundColor: theme.primaryBg }]}
                  onPress={() => onSelectEnergy(e)}
                >
                  <Text style={{ fontSize: 20 }}>{ENERGY_EMOJI[e]}</Text>
                </PressableScale>
              ))}
            </View>
          </Card>
        ) : (
          <Card variant="outlined">
            <View style={ss.emptyWrap}>
              <EmptyMood width={80} height={54} color={theme.textSecondary} />
              <Text style={[ss.meta, { color: theme.textSecondary }]}>
                Tap your mood (1–5), then energy.
              </Text>
            </View>
            <View style={[ss.row, { marginTop: 12 }]}>
              {[1, 2, 3, 4, 5].map((m) => (
                <PressableScale
                  key={m}
                  style={[ss.chip, { backgroundColor: theme.warnBg }]}
                  onPress={() => onSelectMood(m)}
                >
                  <Text style={{ fontSize: 20 }}>{MOOD_EMOJI[m]}</Text>
                </PressableScale>
              ))}
            </View>
          </Card>
        )}
      </Section>

      {moodLogs.length > 0 && (
        <Section title="Recent logs">
          {moodLogs.slice(0, 7).map((log) => (
            <Card key={log.id} variant="outlined" style={ss.logCard}>
              <View style={ss.row}>
                <Text style={{ fontSize: 24 }}>
                  {MOOD_EMOJI[log.mood]} {ENERGY_EMOJI[log.energy]}
                </Text>
                <Text style={[ss.meta, { color: theme.textSecondary }]}>
                  {dayjs(log.logged_at).format('MMM D, h:mm A')}
                </Text>
              </View>
            </Card>
          ))}
        </Section>
      )}
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  emptyWrap: { alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { fontSize: 13 },
  big: { fontSize: 30, fontWeight: '700' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  logCard: { marginBottom: 8 },
});
