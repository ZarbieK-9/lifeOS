// Habit Detail Modal — shows streak, best streak, weekly heatmap
import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Alert } from 'react-native';
import dayjs from 'dayjs';
import { useAppTheme } from '../hooks/useAppTheme';
import type { Habit } from '../store/useStore';

interface HabitStats {
  currentStreak: number;
  bestStreak: number;
  weeklyCount: number;
  totalLogged: number;
  last30Days: { date: string; count: number }[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
  habit: Habit | null;
  stats: HabitStats | null;
  onDelete: (id: string) => void;
}

export function HabitDetailModal({ visible, onClose, habit, stats, onDelete }: Props) {
  const { theme } = useAppTheme();
  if (!habit || !stats) return null;

  const target = habit.target_per_day;

  // Build 4-week grid (rows = weeks, cols = Mon-Sun)
  const weeks: { date: string; count: number; inMonth: boolean }[][] = [];
  let currentWeek: typeof weeks[0] = [];
  for (const d of stats.last30Days) {
    const dow = dayjs(d.date).day(); // 0=Sun
    if (dow === 1 && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push({ ...d, inMonth: true });
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  const handleDelete = () => {
    Alert.alert('Delete Habit', `Delete "${habit.name}" and all its logs?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { onDelete(habit.id); onClose(); } },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={ss.overlay}>
        <View style={[ss.sheet, { backgroundColor: theme.background }]}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={ss.header}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 28 }}>{habit.icon}</Text>
                <Text style={[ss.title, { color: theme.text }]}>{habit.name}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={ss.closeBtn}>
                <Text style={{ color: theme.textSecondary, fontSize: 28 }}>×</Text>
              </TouchableOpacity>
            </View>

            {/* Stats grid */}
            <View style={ss.statsGrid}>
              <View style={[ss.statBox, { backgroundColor: theme.surface }]}>
                <Text style={[ss.statValue, { color: theme.primary }]}>{stats.currentStreak}</Text>
                <Text style={[ss.statLabel, { color: theme.textSecondary }]}>Current Streak</Text>
              </View>
              <View style={[ss.statBox, { backgroundColor: theme.surface }]}>
                <Text style={[ss.statValue, { color: theme.warn }]}>{stats.bestStreak}</Text>
                <Text style={[ss.statLabel, { color: theme.textSecondary }]}>Best Streak</Text>
              </View>
              <View style={[ss.statBox, { backgroundColor: theme.surface }]}>
                <Text style={[ss.statValue, { color: theme.success }]}>{stats.weeklyCount}/7</Text>
                <Text style={[ss.statLabel, { color: theme.textSecondary }]}>This Week</Text>
              </View>
              <View style={[ss.statBox, { backgroundColor: theme.surface }]}>
                <Text style={[ss.statValue, { color: theme.text }]}>{stats.totalLogged}</Text>
                <Text style={[ss.statLabel, { color: theme.textSecondary }]}>Total{habit.unit ? ` ${habit.unit}` : ''}</Text>
              </View>
            </View>

            {/* Summary sentence */}
            <Text style={[ss.summary, { color: theme.text }]}>
              You've done {habit.name.toLowerCase()} {stats.weeklyCount}/7 days this week
              {stats.currentStreak > 1 ? ` with a ${stats.currentStreak}-day streak!` : '.'}
            </Text>

            {/* 30-day heatmap */}
            <Text style={[ss.sectionTitle, { color: theme.text }]}>Last 30 Days</Text>
            <View style={ss.heatmap}>
              {stats.last30Days.map((d, i) => {
                const done = d.count >= target;
                const partial = d.count > 0 && !done;
                const bgColor = done ? theme.success : partial ? theme.primary + '60' : theme.border + '40';
                const isToday = d.date === dayjs().format('YYYY-MM-DD');
                return (
                  <View key={i} style={[ss.heatCell, {
                    backgroundColor: bgColor,
                    borderWidth: isToday ? 2 : 0,
                    borderColor: theme.primary,
                  }]} />
                );
              })}
            </View>
            <View style={ss.legend}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={[ss.legendDot, { backgroundColor: theme.border + '40' }]} />
                <Text style={[ss.legendText, { color: theme.textSecondary }]}>Missed</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={[ss.legendDot, { backgroundColor: theme.primary + '60' }]} />
                <Text style={[ss.legendText, { color: theme.textSecondary }]}>Partial</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={[ss.legendDot, { backgroundColor: theme.success }]} />
                <Text style={[ss.legendText, { color: theme.textSecondary }]}>Done</Text>
              </View>
            </View>

            {/* Delete */}
            <TouchableOpacity style={[ss.deleteBtn, { backgroundColor: theme.dangerBg }]} onPress={handleDelete}>
              <Text style={{ color: theme.danger, fontWeight: '600', fontSize: 15 }}>Delete Habit</Text>
            </TouchableOpacity>
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
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  statBox: { width: '47%', borderRadius: 14, padding: 14, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 28, fontWeight: '800' },
  statLabel: { fontSize: 12, fontWeight: '500' },
  summary: { fontSize: 15, fontWeight: '500', marginTop: 16, lineHeight: 22 },
  sectionTitle: { fontSize: 17, fontWeight: '600', marginTop: 20, marginBottom: 10 },
  heatmap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  heatCell: { width: 28, height: 28, borderRadius: 6 },
  legend: { flexDirection: 'row', gap: 16, marginTop: 8 },
  legendDot: { width: 12, height: 12, borderRadius: 3 },
  legendText: { fontSize: 11 },
  deleteBtn: { alignItems: 'center', paddingVertical: 14, borderRadius: 14, marginTop: 24 },
});
