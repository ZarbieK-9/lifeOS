import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from 'react-native';
import dayjs from 'dayjs';
import { useStore } from '@/src/store/useStore';
import { useHaptics } from '@/src/hooks/useHaptics';
import { PressableScale } from '@/components/PressableScale';
import { ScreenContainer, Section, ScreenHeader } from '@/src/components/layout';
import { Card } from '@/src/components/Card';
import { HabitDetailModal } from '@/src/components/HabitDetailModal';
import { EmptyHabits } from '@/src/components/illustrations';
import { Typography, Spacing } from '@/constants/theme';
import { useAppTheme } from '@/src/hooks/useAppTheme';

export default function HabitsScreen() {
  const { theme } = useAppTheme();
  const haptic = useHaptics();
  const habits = useStore((s) => s.habits);
  const habitLogs = useStore((s) => s.habitLogs);
  const addHabit = useStore((s) => s.addHabit);
  const logHabitEntry = useStore((s) => s.logHabitEntry);
  const deleteHabit = useStore((s) => s.deleteHabit);
  const getHabitStats = useStore((s) => s.getHabitStats);

  const [showAddHabit, setShowAddHabit] = useState(false);
  const [showHabitDetail, setShowHabitDetail] = useState<string | null>(null);
  const [habitName, setHabitName] = useState('');
  const [habitIcon, setHabitIcon] = useState('');
  const [habitTarget, setHabitTarget] = useState('1');
  const [habitUnit, setHabitUnit] = useState('');

  const todayStr = dayjs().format('YYYY-MM-DD');
  const habitTodayCounts = habits.reduce(
    (acc, h) => {
      acc[h.id] = habitLogs
        .filter((l) => l.habit_id === h.id && l.logged_at.startsWith(todayStr))
        .reduce((s, l) => s + l.value, 0);
      return acc;
    },
    {} as Record<string, number>
  );

  const onAddHabit = useCallback(async () => {
    if (!habitName.trim()) return;
    haptic.success();
    await addHabit(
      habitName.trim(),
      habitIcon || '✓',
      parseInt(habitTarget, 10) || 1,
      habitUnit.trim() || null
    );
    setHabitName('');
    setHabitIcon('');
    setHabitTarget('1');
    setHabitUnit('');
    setShowAddHabit(false);
  }, [habitName, habitIcon, habitTarget, habitUnit, addHabit, haptic]);

  const onLogHabit = useCallback(
    async (habitId: string) => {
      haptic.light();
      await logHabitEntry(habitId, 1);
    },
    [haptic, logHabitEntry]
  );

  const enabledHabits = habits.filter((h) => h.enabled);

  return (
    <ScreenContainer scroll header={<ScreenHeader title="Habits" />}>
      <Section
        title="Today's progress"
        description={
          enabledHabits.length === 0
            ? 'Add a habit to start tracking.'
            : undefined
        }
      >
        {enabledHabits.length === 0 ? (
          <Card variant="outlined">
            <View style={ss.emptyWrap}>
              <EmptyHabits width={100} height={70} color={theme.textSecondary} />
              <Text style={[ss.empty, { color: theme.textSecondary }]}>
                No habits yet — tap "Add habit" to create one.
              </Text>
            </View>
          </Card>
        ) : (
          enabledHabits.map((h) => {
            const count = habitTodayCounts[h.id] ?? 0;
            const target = h.target_per_day;
            const done = count >= target;
            return (
              <TouchableOpacity
                key={h.id}
                activeOpacity={0.7}
                onPress={() => setShowHabitDetail(h.id)}
              >
                <Card variant="default" style={ss.habitCard}>
                  <View style={ss.row}>
                    <Text style={ss.habitIcon}>{h.icon}</Text>
                    <View style={ss.habitMain}>
                      <Text
                        style={[
                          ss.habitName,
                          { color: theme.text },
                          done && { color: theme.success },
                        ]}
                      >
                        {h.name}
                      </Text>
                      <Text style={[ss.meta, { color: theme.textSecondary }]}>
                        {count}/{target}
                        {h.unit ? ` ${h.unit}` : ''}
                      </Text>
                    </View>
                    <View
                      style={[
                        ss.track,
                        { backgroundColor: theme.border + '80' },
                      ]}
                    >
                      <View
                        style={[
                          ss.bar,
                          {
                            width: `${Math.min((count / target) * 100, 100)}%`,
                            backgroundColor: done ? theme.success : theme.primary,
                          },
                        ]}
                      />
                    </View>
                    {!done ? (
                      <PressableScale
                        onPress={() => onLogHabit(h.id)}
                        style={[ss.logBtn, { backgroundColor: theme.primaryBg }]}
                      >
                        <Text
                          style={[ss.chipText, { color: theme.primary }]}
                        >
                          +1
                        </Text>
                      </PressableScale>
                    ) : (
                      <View
                        style={[ss.logBtn, { backgroundColor: theme.successBg }]}
                      >
                        <Text
                          style={{
                            color: theme.success,
                            fontWeight: '700',
                            fontSize: 14,
                          }}
                        >
                          ✓
                        </Text>
                      </View>
                    )}
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })
        )}
        <PressableScale
          onPress={() => setShowAddHabit(true)}
          style={[ss.addBtn, { backgroundColor: theme.primaryBg }]}
        >
          <Text style={[ss.addBtnText, { color: theme.primary }]}>
            + Add habit
          </Text>
        </PressableScale>
      </Section>

      <Modal
        visible={showAddHabit}
        animationType="slide"
        transparent
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={ss.modalBg}
        >
          <View style={[ss.modal, { backgroundColor: theme.background }]}>
            <Text style={[ss.modalTitle, { color: theme.text }]}>
              New Habit
            </Text>
            <TextInput
              style={[
                ss.input,
                {
                  backgroundColor: theme.surface,
                  color: theme.text,
                  borderColor: theme.border,
                },
              ]}
              placeholder="Habit name (e.g. Exercise)"
              placeholderTextColor={theme.textSecondary}
              value={habitName}
              onChangeText={setHabitName}
              autoFocus
            />
            <View style={ss.row}>
              <TextInput
                style={[
                  ss.input,
                  {
                    flex: 1,
                    backgroundColor: theme.surface,
                    color: theme.text,
                    borderColor: theme.border,
                  },
                ]}
                placeholder="Icon (emoji)"
                placeholderTextColor={theme.textSecondary}
                value={habitIcon}
                onChangeText={setHabitIcon}
              />
              <TextInput
                style={[
                  ss.input,
                  {
                    flex: 1,
                    backgroundColor: theme.surface,
                    color: theme.text,
                    borderColor: theme.border,
                  },
                ]}
                placeholder="Target/day"
                placeholderTextColor={theme.textSecondary}
                value={habitTarget}
                onChangeText={setHabitTarget}
                keyboardType="numeric"
              />
              <TextInput
                style={[
                  ss.input,
                  {
                    flex: 1,
                    backgroundColor: theme.surface,
                    color: theme.text,
                    borderColor: theme.border,
                  },
                ]}
                placeholder="Unit"
                placeholderTextColor={theme.textSecondary}
                value={habitUnit}
                onChangeText={setHabitUnit}
              />
            </View>
            <View style={ss.modalActions}>
              <TouchableOpacity
                style={ss.modalCancel}
                onPress={() => setShowAddHabit(false)}
              >
                <Text
                  style={[
                    ss.meta,
                    { color: theme.textSecondary, fontWeight: '600', fontSize: 16 },
                  ]}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
              <PressableScale
                style={[
                  ss.modalSubmit,
                  { backgroundColor: theme.primary },
                ]}
                onPress={onAddHabit}
              >
                <Text
                  style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}
                >
                  Add Habit
                </Text>
              </PressableScale>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <HabitDetailModal
        visible={!!showHabitDetail}
        onClose={() => setShowHabitDetail(null)}
        habit={habits.find((h) => h.id === showHabitDetail) ?? null}
        stats={
          showHabitDetail ? getHabitStats(showHabitDetail) : null
        }
        onDelete={(id) => {
          deleteHabit(id);
          setShowHabitDetail(null);
        }}
      />
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  emptyWrap: { alignItems: 'center', paddingVertical: 12, gap: 8 },
  empty: { ...Typography.body, textAlign: 'center' },
  habitCard: { marginBottom: 12 },
  habitIcon: { fontSize: 20, width: 28, textAlign: 'center' },
  habitMain: { flex: 1, minWidth: 0 },
  habitName: { fontSize: 14, fontWeight: '500' },
  meta: { fontSize: 13 },
  track: { width: 50, height: 6, borderRadius: 3, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 3 },
  logBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  addBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  addBtnText: { fontSize: 16, fontWeight: '600' },
  modalBg: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: '#00000066',
  },
  modal: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 12,
  },
  modalTitle: { fontSize: 22, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  modalCancel: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  modalSubmit: {
    flex: 2,
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 14,
  },
});
