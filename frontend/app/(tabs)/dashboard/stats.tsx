import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useStore } from '@/src/store/useStore';
import { ScreenContainer, Section, ScreenHeader } from '@/src/components/layout';
import { Card } from '@/src/components/Card';
import { WeekChart } from '@/src/components/WeekChart';
import { useAppTheme } from '@/src/hooks/useAppTheme';
import { Typography } from '@/constants/theme';

export default function StatsScreen() {
  const { theme } = useAppTheme();
  const hydrationLast7Days = useStore((s) => s.hydrationLast7Days);
  const sleepLast7Days = useStore((s) => s.sleepLast7Days);

  const hasData = hydrationLast7Days || sleepLast7Days;

  return (
    <ScreenContainer scroll header={<ScreenHeader title="Stats & insights" />}>
      <Section
        title="Last 7 days"
        description="Hydration and sleep over the past week."
      >
        {!hasData ? (
          <Card variant="outlined">
            <Text style={[ss.empty, { color: theme.textSecondary }]}>
              No data yet. Log hydration and sleep to see your trends here.
            </Text>
          </Card>
        ) : (
          <>
            {hydrationLast7Days && (
              <Card variant="elevated" style={ss.chartCard}>
                <Text style={[ss.chartTitle, { color: theme.text }]}>
                  Hydration (ml)
                </Text>
                <WeekChart
                  days={hydrationLast7Days.days}
                  values={hydrationLast7Days.values}
                  unit="ml"
                  label="Hydration (ml)"
                  barColor={theme.primary}
                  textColor={theme.textSecondary}
                  formatValue={(v) => `${v}`}
                />
              </Card>
            )}
            {sleepLast7Days && (
              <Card variant="elevated" style={ss.chartCard}>
                <Text style={[ss.chartTitle, { color: theme.text }]}>
                  Sleep (hours)
                </Text>
                <WeekChart
                  days={sleepLast7Days.days}
                  values={sleepLast7Days.values.map((m) =>
                    Math.round((m / 60) * 10) / 10
                  )}
                  unit="h"
                  label="Sleep (hours)"
                  barColor={theme.warn}
                  textColor={theme.textSecondary}
                  formatValue={(v) => (v ? `${v}h` : '–')}
                />
              </Card>
            )}
          </>
        )}
      </Section>
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  empty: { ...Typography.body, paddingVertical: 8 },
  chartCard: { marginBottom: 16 },
  chartTitle: { ...Typography.headline, marginBottom: 8 },
});
