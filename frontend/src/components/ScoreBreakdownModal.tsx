// Score Breakdown Modal — shows daily score components + 7-day bar chart
import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import dayjs from 'dayjs';
import { useAppTheme } from '../hooks/useAppTheme';

interface Props {
  visible: boolean;
  onClose: () => void;
  breakdown: { hydration: number; tasks: number; sleep: number; habits: number };
  score: number;
  streakData: { date: string; score: number }[];
}

const COMPONENTS = [
  { key: 'hydration', label: 'Hydration', max: 30, icon: 'H' },
  { key: 'tasks', label: 'Tasks', max: 40, icon: 'T' },
  { key: 'sleep', label: 'Sleep', max: 20, icon: 'S' },
  { key: 'habits', label: 'Habits', max: 10, icon: 'B' },
] as const;

export function ScoreBreakdownModal({ visible, onClose, breakdown, score, streakData }: Props) {
  const { theme } = useAppTheme();

  // Ensure 7 days shown (fill missing with 0)
  const days: { label: string; score: number; isToday: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = dayjs().subtract(i, 'day');
    const dateStr = d.format('YYYY-MM-DD');
    const match = streakData.find(s => s.date === dateStr);
    days.push({
      label: d.format('ddd'),
      score: match?.score ?? 0,
      isToday: i === 0,
    });
  }
  const maxBarHeight = 100;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[ss.overlay]}>
        <View style={[ss.sheet, { backgroundColor: theme.background }]}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={ss.header}>
              <Text style={[ss.title, { color: theme.text }]}>Score Breakdown</Text>
              <TouchableOpacity onPress={onClose} style={ss.closeBtn}>
                <Text style={{ color: theme.textSecondary, fontSize: 28 }}>×</Text>
              </TouchableOpacity>
            </View>

            {/* Total score */}
            <View style={[ss.totalRow, { backgroundColor: theme.surface }]}>
              <Text style={[ss.totalScore, { color: score >= 80 ? theme.success : score >= 50 ? theme.warn : theme.danger }]}>
                {score}
              </Text>
              <Text style={[ss.totalLabel, { color: theme.textSecondary }]}> / 100</Text>
            </View>

            {/* Component bars */}
            <View style={{ gap: 12, marginTop: 16 }}>
              {COMPONENTS.map(c => {
                const pts = breakdown[c.key];
                const pct = Math.round((pts / c.max) * 100);
                return (
                  <View key={c.key} style={{ gap: 4 }}>
                    <View style={ss.compRow}>
                      <Text style={[ss.compLabel, { color: theme.text }]}>{c.label}</Text>
                      <Text style={[ss.compPts, { color: pts >= c.max ? theme.success : theme.primary }]}>
                        {pts}/{c.max}
                      </Text>
                    </View>
                    <View style={[ss.track, { backgroundColor: theme.border + '60' }]}>
                      <View style={[ss.bar, {
                        width: `${pct}%`,
                        backgroundColor: pts >= c.max ? theme.success : theme.primary,
                      }]} />
                    </View>
                  </View>
                );
              })}
            </View>

            {/* 7-day chart */}
            <Text style={[ss.chartTitle, { color: theme.text }]}>Last 7 Days</Text>
            <View style={ss.chartContainer}>
              {days.map((d, i) => {
                const h = d.score > 0 ? Math.max((d.score / 100) * maxBarHeight, 4) : 4;
                const barColor = d.score >= 80 ? theme.success : d.score >= 50 ? theme.warn : d.score > 0 ? theme.danger : theme.border;
                return (
                  <View key={i} style={ss.barCol}>
                    <Text style={[ss.barValue, { color: theme.textSecondary }]}>
                      {d.score > 0 ? d.score : ''}
                    </Text>
                    <View style={[ss.chartBar, {
                      height: h,
                      backgroundColor: barColor,
                      borderWidth: d.isToday ? 2 : 0,
                      borderColor: theme.primary,
                    }]} />
                    <Text style={[ss.dayLabel, {
                      color: d.isToday ? theme.primary : theme.textSecondary,
                      fontWeight: d.isToday ? '700' : '400',
                    }]}>
                      {d.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const ss = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '80%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '700' },
  closeBtn: { padding: 4 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', borderRadius: 16, padding: 20, marginTop: 12 },
  totalScore: { fontSize: 48, fontWeight: '800' },
  totalLabel: { fontSize: 20 },
  compRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  compLabel: { fontSize: 15, fontWeight: '500' },
  compPts: { fontSize: 14, fontWeight: '600' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4 },
  chartTitle: { fontSize: 17, fontWeight: '600', marginTop: 24, marginBottom: 12 },
  chartContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 140, paddingTop: 20 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barValue: { fontSize: 11, fontWeight: '500' },
  chartBar: { width: 24, borderRadius: 6, minHeight: 4 },
  dayLabel: { fontSize: 11 },
});
