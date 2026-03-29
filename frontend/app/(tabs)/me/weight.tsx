import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import dayjs from 'dayjs';
import { useStore } from '@/src/store/useStore';
import { ScreenContainer, Section, ScreenHeader } from '@/src/components/layout';
import { Card } from '@/src/components/Card';
import { WeekChart } from '@/src/components/WeekChart';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { Typography } from '@/constants/theme';

export default function MeWeightScreen() {
  const { theme } = useAppTheme();
  const weightLogs = useStore((s) => s.weightLogs);
  const userProfile = useStore((s) => s.userProfile);

  const currentWeight = userProfile?.weight_kg ?? null;
  const last7 = weightLogs.slice(0, 7).reverse();
  const days = last7.map((l) => dayjs(l.date).format('ddd'));
  const values = last7.map((l) => l.weight_kg);

  return (
    <ScreenContainer scroll header={<ScreenHeader title="Weight history" />}>
      <Section title="Current" description="Latest from profile and logs.">
        <Card variant="elevated">
          <Text style={[ss.label, { color: theme.textSecondary }]}>Current weight</Text>
          <Text style={[ss.big, { color: theme.primary }]}>
            {currentWeight != null ? `${currentWeight} kg` : '—'}
          </Text>
        </Card>
      </Section>

      <Section title="Last 7 entries">
        {weightLogs.length === 0 ? (
          <Card variant="outlined">
            <Text style={[ss.empty, { color: theme.textSecondary }]}>
              No weight logs yet. Update your weight on the Me screen to see history here.
            </Text>
          </Card>
        ) : (
          <>
            {days.length > 0 && values.length > 0 && (
              <Card variant="elevated" style={ss.chartCard}>
                <WeekChart
                  days={days}
                  values={values}
                  unit="kg"
                  label="Weight (kg)"
                  barColor={theme.primary}
                  textColor={theme.textSecondary}
                  formatValue={(v) => (v ? `${v}kg` : '–')}
                />
              </Card>
            )}
            {weightLogs.slice(0, 14).map((log) => (
              <Card key={log.id} variant="outlined" style={ss.logCard}>
                <View style={ss.row}>
                  <Text style={[ss.date, { color: theme.textSecondary }]}>
                    {dayjs(log.date).format('MMM D, YYYY')}
                  </Text>
                  <Text style={[ss.weight, { color: theme.text }]}>{log.weight_kg} kg</Text>
                </View>
              </Card>
            ))}
          </>
        )}
      </Section>
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  label: { ...Typography.footnote },
  big: { fontSize: 28, fontWeight: '700', marginTop: 4 },
  empty: { ...Typography.body, paddingVertical: 8 },
  chartCard: { marginBottom: 12 },
  logCard: { marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { ...Typography.footnote },
  weight: { fontSize: 17, fontWeight: '600' },
});
