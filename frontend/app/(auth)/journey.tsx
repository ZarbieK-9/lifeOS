import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { kv } from '@/src/db/mmkv';
import { PrimaryButton } from '@/src/components/PrimaryButton';
import { Spacing, Typography } from '@/constants/theme';

type JourneyStep = {
  title: string;
  subtitle: string;
  bullets: string[];
};

export default function JourneyScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const [idx, setIdx] = useState(0);

  const steps = useMemo<JourneyStep[]>(
    () => [
      {
        title: 'Welcome to LifeOS',
        subtitle: 'Your AI companion for capture, planning, and follow-through.',
        bullets: [
          'Capture thoughts, tasks, and reminders quickly.',
          'Get proactive coaching based on your day and habits.',
          'Stay in control with approval-based actions.',
        ],
      },
      {
        title: 'What the agent can do',
        subtitle: 'LifeOS helps you execute, not just chat.',
        bullets: [
          'Turn requests into tasks, reminders, and schedules.',
          'Suggest next best actions from context (calendar, inbox, goals).',
          'Learn from outcomes to improve future nudges.',
        ],
      },
      {
        title: 'Where to start',
        subtitle: 'Use this quick path for your first day.',
        bullets: [
          'AI tab: say what you need in plain language.',
          'Dashboard: track hydration, mood, habits, and coaching.',
          'Settings: connect Google/Microsoft and tune notifications.',
        ],
      },
    ],
    [],
  );

  const current = steps[idx];
  const isLast = idx === steps.length - 1;

  const finish = () => {
    kv.set('onboarding_journey_done', '1');
    kv.set('onboarding_journey_seen_at', new Date().toISOString());
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={[ss.fill, { backgroundColor: theme.background }]} edges={['top', 'left', 'right', 'bottom']}>
      <View style={ss.content}>
        <Text style={[ss.step, { color: theme.textSecondary }]}>
          Step {idx + 1} of {steps.length}
        </Text>
        <Text style={[ss.title, { color: theme.text }]}>{current.title}</Text>
        <Text style={[ss.subtitle, { color: theme.textSecondary }]}>{current.subtitle}</Text>

        <View style={[ss.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          {current.bullets.map((b) => (
            <Text key={b} style={[ss.bullet, { color: theme.text }]}>• {b}</Text>
          ))}
        </View>

        <View style={ss.actions}>
          {!isLast ? (
            <PrimaryButton title="Next" onPress={() => setIdx((v) => Math.min(v + 1, steps.length - 1))} />
          ) : (
            <PrimaryButton title="Get Started" onPress={finish} />
          )}
          <TouchableOpacity onPress={finish}>
            <Text style={[ss.skip, { color: theme.textSecondary }]}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  fill: { flex: 1 },
  content: { flex: 1, paddingHorizontal: Spacing.screenPaddingWide, paddingTop: 24, paddingBottom: 24 },
  step: { ...Typography.caption1, marginBottom: 12, fontWeight: '600' },
  title: { ...Typography.largeTitle, marginBottom: 8 },
  subtitle: { ...Typography.body, marginBottom: 20, lineHeight: 22 },
  card: { borderWidth: 1, borderRadius: 28, padding: 16, gap: 12 },
  bullet: { ...Typography.callout, lineHeight: 22 },
  actions: { marginTop: 'auto', gap: 14 },
  skip: { ...Typography.callout, textAlign: 'center' },
});
