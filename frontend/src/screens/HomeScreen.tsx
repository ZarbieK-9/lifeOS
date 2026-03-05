// Home / Dashboard — UI_UX.md §3.1
// Top: sleep status, hydration, focus mode
// Middle: progress cards
// Bottom: quick actions + offline queue badge
// Boot hooks live in app/_layout.tsx so they run on any tab.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch,
  ActivityIndicator, Platform, TextInput, Modal, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { useHaptics } from '../hooks/useHaptics';
import { PressableScale } from '@/components/PressableScale';
import { Card } from '@/src/components/Card';
import { Typography, Spacing, Radii } from '@/constants/theme';
import { useAppTheme } from '../hooks/useAppTheme';
import { ScoreBreakdownModal } from '../components/ScoreBreakdownModal';
import { HabitDetailModal } from '../components/HabitDetailModal';
import { TimelineView } from '../components/TimelineView';

const QUICK_AMOUNTS = [250, 500, 750];

export default function HomeScreen() {
  const { theme } = useAppTheme();
  const haptic = useHaptics();

  // Store
  const ready = useStore(s => s.ready);
  const init = useStore(s => s.init);
  const isOnline = useStore(s => s.isOnline);
  const sleep = useStore(s => s.sleep);
  const hydration = useStore(s => s.hydrationTodayMl);
  const logHydration = useStore(s => s.logHydration);
  const focusEnabled = useStore(s => s.focusEnabled);
  const focusRemaining = useStore(s => s.focusRemainingMin);
  const focusDuration = useStore(s => s.focusDurationMin);
  const focusStarted = useStore(s => s.focusStartedAt);
  const toggleFocus = useStore(s => s.toggleFocus);
  const queueCount = useStore(s => s.queueCount);
  const drainQueue = useStore(s => s.drainQueue);
  const dailyScore = useStore(s => s.dailyScore);
  const currentStreak = useStore(s => s.currentStreak);
  const scoreBreakdown = useStore(s => s.scoreBreakdown);
  const streakData = useStore(s => s.streakData);
  const habits = useStore(s => s.habits);
  const habitLogs = useStore(s => s.habitLogs);
  const addHabit = useStore(s => s.addHabit);
  const logHabitEntry = useStore(s => s.logHabitEntry);
  const deleteHabit = useStore(s => s.deleteHabit);

  // Mood
  const moodLogs = useStore(s => s.moodLogs);
  const addMoodLog = useStore(s => s.addMoodLog);

  // Notes
  const notes = useStore(s => s.notes);

  // Inbox
  const inboxItems = useStore(s => s.inboxItems);
  const addInboxItem = useStore(s => s.addInboxItem);

  // Expenses
  const todaySpend = useStore(s => s.todaySpend);
  const monthSpend = useStore(s => s.monthSpend);
  const expenses = useStore(s => s.expenses);

  // Time blocks
  const timeBlocks = useStore(s => s.timeBlocks);

  const getHabitStats = useStore(s => s.getHabitStats);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
  const [showHabitDetail, setShowHabitDetail] = useState<string | null>(null);
  const [showAddHabit, setShowAddHabit] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [moodPending, setMoodPending] = useState<number | null>(null);
  const [habitName, setHabitName] = useState('');
  const [habitIcon, setHabitIcon] = useState('');
  const [habitTarget, setHabitTarget] = useState('1');
  const [habitUnit, setHabitUnit] = useState('');

  // Hydration reminders
  const hydrationGoalMl = useStore(s => s.hydrationGoalMl);
  const hydrationReminderEnabled = useStore(s => s.hydrationReminderEnabled);
  const nextHydrationReminderAt = useStore(s => s.nextHydrationReminderAt);
  const TARGET_ML = hydrationGoalMl || 2500;

  // Google
  const isGoogleConnected = useStore(s => s.isGoogleConnected);
  const calendarEvents = useStore(s => s.calendarEvents);
  const emails = useStore(s => s.emails);
  const unreadEmailCount = useStore(s => s.unreadEmailCount);
  const syncCalendarEvents = useStore(s => s.syncCalendarEvents);
  const syncEmails = useStore(s => s.syncEmails);
  const tasks = useStore(s => s.tasks);

  useEffect(() => { init(); }, [init]);

  // Auto-sync Google data on mount
  useEffect(() => {
    if (isGoogleConnected) {
      syncCalendarEvents();
      syncEmails();
    }
  }, [isGoogleConnected, syncCalendarEvents, syncEmails]);

  const onQuickLog = useCallback(async (ml: number) => {
    haptic.success();
    await logHydration(ml);
  }, [haptic, logHydration]);

  const onToggleFocus = useCallback(() => {
    haptic.medium();
    toggleFocus(45);
  }, [haptic, toggleFocus]);

  const onSync = useCallback(() => {
    haptic.light();
    drainQueue();
  }, [haptic, drainQueue]);

  const onAddHabit = useCallback(async () => {
    if (!habitName.trim()) return;
    haptic.success();
    await addHabit(habitName.trim(), habitIcon || '✓', parseInt(habitTarget) || 1, habitUnit.trim() || null);
    setHabitName(''); setHabitIcon(''); setHabitTarget('1'); setHabitUnit('');
    setShowAddHabit(false);
  }, [habitName, habitIcon, habitTarget, habitUnit, addHabit, haptic]);

  const onLogHabit = useCallback(async (habitId: string) => {
    haptic.light();
    await logHabitEntry(habitId, 1);
  }, [haptic, logHabitEntry]);

  // Today's log count per habit
  const todayStr = dayjs().format('YYYY-MM-DD');
  const habitTodayCounts = habits.reduce((acc, h) => {
    acc[h.id] = habitLogs.filter(l => l.habit_id === h.id && l.logged_at.startsWith(todayStr)).reduce((s, l) => s + l.value, 0);
    return acc;
  }, {} as Record<string, number>);

  if (!ready) {
    return (
      <SafeAreaView style={[ss.fill, { backgroundColor: theme.background }]} edges={['top', 'left', 'right', 'bottom']}>
        <View style={ss.center}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[ss.loadText, { color: theme.textSecondary }]}>Loading LifeOS…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const pct = Math.min(Math.round((hydration / TARGET_ML) * 100), 100);
  const sleepDur = sleep.isAsleep && sleep.sleepStart
    ? `${dayjs().diff(dayjs(sleep.sleepStart), 'hour')}h ${dayjs().diff(dayjs(sleep.sleepStart), 'minute') % 60}m`
    : sleep.durationMinutes > 0
      ? `${Math.floor(sleep.durationMinutes / 60)}h ${sleep.durationMinutes % 60}m`
      : '--';

  return (
    <SafeAreaView style={[ss.fill, { backgroundColor: theme.background }]} edges={['top', 'left', 'right', 'bottom']}>
      {!isOnline && (
        <View style={[ss.offBar, { backgroundColor: theme.warnBg }]}>
          <View style={[ss.offDot, { backgroundColor: theme.warn }]} />
          <Text style={[ss.offText, { color: theme.warn }]}>
            Offline{queueCount > 0 ? ` · ${queueCount} queued` : ''}
          </Text>
        </View>
      )}

      <ScrollView contentContainerStyle={ss.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[ss.greeting, { color: theme.text }]}>{greeting()}</Text>
        <Text style={[ss.date, { color: theme.textSecondary }]}>{dayjs().format('dddd, MMMM D')}</Text>

        {/* Daily Score & Streak */}
        <TouchableOpacity activeOpacity={0.7} onPress={() => setShowScoreBreakdown(true)}>
        <Card style={ss.cardInner}>
          <View style={ss.row}>
            <View style={[ss.badge, { backgroundColor: theme.successBg }]}>
              <Text style={[ss.badgeIcon, { color: theme.success }]}>
                {dailyScore >= 80 ? '★' : '☆'}
              </Text>
            </View>
            <Text style={[ss.cardTitle, { color: theme.text }]}>Daily Score</Text>
            {currentStreak > 0 && (
              <View style={[ss.chip, { backgroundColor: theme.warnBg, paddingVertical: 2, paddingHorizontal: 8 }]}>
                <Text style={{ color: theme.warn, fontSize: 12, fontWeight: '700' }}>
                  {currentStreak} day{currentStreak > 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>
          <Text style={[ss.big, { color: theme.success }]}>{dailyScore}<Text style={[ss.unit, { color: theme.textSecondary }]}> / 100</Text></Text>
          <View style={[ss.track, { backgroundColor: theme.border + '80' }]}>
            <View style={[ss.bar, {
              width: `${Math.min(dailyScore, 100)}%`,
              backgroundColor: dailyScore >= 80 ? theme.success : dailyScore >= 50 ? theme.warn : theme.danger,
            }]} />
          </View>
          <Text style={[ss.meta, { color: theme.textSecondary }]}>
            {dailyScore >= 80 ? 'Great day!' : dailyScore >= 50 ? 'Keep going!' : 'Tap for breakdown'}
          </Text>
        </Card>
        </TouchableOpacity>

        {/* Habits */}
        <Card style={ss.cardInner}>
          <View style={ss.row}>
            <View style={[ss.badge, { backgroundColor: theme.primaryBg }]}>
              <Text style={[ss.badgeIcon, { color: theme.primary }]}>H</Text>
            </View>
            <Text style={[ss.cardTitle, { color: theme.text }]}>Habits</Text>
            <TouchableOpacity onPress={() => setShowAddHabit(true)}>
              <Text style={[ss.pct, { color: theme.primary }]}>+ Add</Text>
            </TouchableOpacity>
          </View>
          {habits.filter(h => h.enabled).length === 0 ? (
            <Text style={[ss.meta, { color: theme.textSecondary }]}>No habits yet — tap + Add to start tracking</Text>
          ) : (
            habits.filter(h => h.enabled).map(h => {
              const count = habitTodayCounts[h.id] || 0;
              const target = h.target_per_day;
              const done = count >= target;
              return (
                <TouchableOpacity key={h.id} style={ss.habitRow} activeOpacity={0.7} onPress={() => setShowHabitDetail(h.id)}>
                  <Text style={ss.habitIcon}>{h.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[ss.habitName, { color: theme.text }, done && { color: theme.success }]}>{h.name}</Text>
                    <Text style={[ss.meta, { color: theme.textSecondary }]}>
                      {count}/{target}{h.unit ? ` ${h.unit}` : ''}
                    </Text>
                  </View>
                  <View style={[ss.habitProgress, { backgroundColor: theme.border + '80' }]}>
                    <View style={[ss.habitProgressFill, {
                      width: `${Math.min((count / target) * 100, 100)}%`,
                      backgroundColor: done ? theme.success : theme.primary,
                    }]} />
                  </View>
                  {!done && (
                    <PressableScale onPress={() => onLogHabit(h.id)} style={[ss.habitLogBtn, { backgroundColor: theme.primaryBg }]}>
                      <Text style={[ss.chipText, { color: theme.primary }]}>+1</Text>
                    </PressableScale>
                  )}
                  {done && (
                    <View style={[ss.habitLogBtn, { backgroundColor: theme.successBg }]}>
                      <Text style={{ color: theme.success, fontWeight: '700', fontSize: 14 }}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </Card>

        {/* Mood & Energy */}
        {(() => {
          const todayMood = moodLogs.find(l => l.logged_at.startsWith(dayjs().format('YYYY-MM-DD')));
          const MOOD_EMOJI = ['', '😞', '😐', '🙂', '😊', '🤩'];
          const ENERGY_EMOJI = ['', '🪫', '😴', '⚡', '🔋', '⚡⚡'];
          return (
            <Card style={ss.cardInner}>
              <View style={ss.row}>
                <View style={[ss.badge, { backgroundColor: theme.warnBg }]}>
                  <Text style={[ss.badgeIcon, { color: theme.warn }]}>M</Text>
                </View>
                <Text style={[ss.cardTitle, { color: theme.text }]}>Mood & Energy</Text>
              </View>
              {todayMood ? (
                <View style={{ gap: 4 }}>
                  <View style={ss.row}>
                    <Text style={{ fontSize: 28 }}>{MOOD_EMOJI[todayMood.mood]}</Text>
                    <Text style={[ss.big, { color: theme.warn }]}>{todayMood.mood}/5</Text>
                    <Text style={[ss.meta, { color: theme.textSecondary }]}>mood</Text>
                    <Text style={{ fontSize: 28, marginLeft: 12 }}>{ENERGY_EMOJI[todayMood.energy]}</Text>
                    <Text style={[ss.big, { color: theme.primary }]}>{todayMood.energy}/5</Text>
                    <Text style={[ss.meta, { color: theme.textSecondary }]}>energy</Text>
                  </View>
                  {todayMood.note && <Text style={[ss.meta, { color: theme.textSecondary }]}>{todayMood.note}</Text>}
                </View>
              ) : moodPending !== null ? (
                <View style={{ gap: 8 }}>
                  <Text style={[ss.meta, { color: theme.textSecondary }]}>Mood: {MOOD_EMOJI[moodPending]} — now tap energy:</Text>
                  <View style={ss.row}>
                    {[1, 2, 3, 4, 5].map(e => (
                      <PressableScale key={e} style={[ss.chip, { backgroundColor: theme.primaryBg }]} onPress={async () => {
                        haptic.success();
                        await addMoodLog(moodPending, e);
                        setMoodPending(null);
                      }}>
                        <Text style={{ fontSize: 20 }}>{ENERGY_EMOJI[e]}</Text>
                      </PressableScale>
                    ))}
                  </View>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  <Text style={[ss.meta, { color: theme.textSecondary }]}>How are you feeling?</Text>
                  <View style={ss.row}>
                    {[1, 2, 3, 4, 5].map(m => (
                      <PressableScale key={m} style={[ss.chip, { backgroundColor: theme.warnBg }]} onPress={() => {
                        haptic.light();
                        setMoodPending(m);
                      }}>
                        <Text style={{ fontSize: 20 }}>{MOOD_EMOJI[m]}</Text>
                      </PressableScale>
                    ))}
                  </View>
                </View>
              )}
            </Card>
          );
        })()}

        {/* Spending */}
        <Card style={ss.cardInner}>
          <View style={ss.row}>
            <View style={[ss.badge, { backgroundColor: theme.dangerBg }]}>
              <Text style={[ss.badgeIcon, { color: theme.danger }]}>$</Text>
            </View>
            <Text style={[ss.cardTitle, { color: theme.text }]}>Spending</Text>
            <Text style={[ss.pct, { color: theme.danger }]}>${todaySpend.toFixed(0)}</Text>
          </View>
          <View style={ss.row}>
            <Text style={[ss.big, { color: theme.danger }]}>${monthSpend.toFixed(0)}</Text>
            <Text style={[ss.unit, { color: theme.textSecondary }]}> this month</Text>
          </View>
          {expenses.length > 0 && (
            <Text style={[ss.meta, { color: theme.textSecondary }]}>
              Last: ${expenses[0].amount.toFixed(2)} ({expenses[0].category})
            </Text>
          )}
        </Card>

        {/* Inbox */}
        {inboxItems.filter(i => !i.triaged).length > 0 && (
          <Card style={ss.cardInner}>
            <View style={ss.row}>
              <View style={[ss.badge, { backgroundColor: theme.primaryBg }]}>
                <Text style={[ss.badgeIcon, { color: theme.primary }]}>I</Text>
              </View>
              <Text style={[ss.cardTitle, { color: theme.text }]}>Inbox</Text>
              <View style={[ss.chip, { backgroundColor: theme.primary, paddingVertical: 2, paddingHorizontal: 8 }]}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                  {inboxItems.filter(i => !i.triaged).length}
                </Text>
              </View>
            </View>
            {inboxItems.filter(i => !i.triaged).slice(0, 3).map(item => (
              <Text key={item.id} style={[ss.meta, { color: theme.text }]} numberOfLines={1}>
                {item.text}
              </Text>
            ))}
            <Text style={[ss.meta, { color: theme.textSecondary }]}>Ask AI to triage your inbox</Text>
          </Card>
        )}

        {/* Journal */}
        {(() => {
          const todayJournal = notes.find(n => n.category === 'journal' && n.created_at.startsWith(dayjs().format('YYYY-MM-DD')));
          return (
            <Card style={ss.cardInner}>
              <View style={ss.row}>
                <View style={[ss.badge, { backgroundColor: theme.primaryBg }]}>
                  <Text style={[ss.badgeIcon, { color: theme.primary }]}>J</Text>
                </View>
                <Text style={[ss.cardTitle, { color: theme.text }]}>Journal</Text>
                <Text style={[ss.pct, { color: theme.primary }]}>{notes.length}</Text>
              </View>
              {todayJournal ? (
                <Text style={[ss.meta, { color: theme.text }]} numberOfLines={2}>
                  {todayJournal.title}{todayJournal.body ? `: ${todayJournal.body.slice(0, 80)}` : ''}
                </Text>
              ) : (
                <Text style={[ss.meta, { color: theme.textSecondary }]}>
                  No journal entry today — tell the AI "write a journal entry"
                </Text>
              )}
            </Card>
          );
        })()}

        {/* My Day — Timeline preview */}
        <TouchableOpacity activeOpacity={0.7} onPress={() => setShowTimeline(true)}>
        <Card style={ss.cardInner}>
          <View style={ss.row}>
            <View style={[ss.badge, { backgroundColor: theme.warnBg }]}>
              <Text style={[ss.badgeIcon, { color: theme.warn }]}>D</Text>
            </View>
            <Text style={[ss.cardTitle, { color: theme.text }]}>My Day</Text>
            <Text style={[ss.pct, { color: theme.warn }]}>
              {calendarEvents.filter(e => !e.all_day && dayjs(e.start_time).isSame(dayjs(), 'day')).length + timeBlocks.length}
            </Text>
          </View>
          {/* Next upcoming event/block */}
          {(() => {
            const upcoming = [
              ...calendarEvents
                .filter(e => !e.all_day && dayjs(e.start_time).isSame(dayjs(), 'day') && dayjs(e.end_time).isAfter(dayjs()))
                .map(e => ({ title: e.summary, start: e.start_time, end: e.end_time, type: 'event' as const })),
              ...timeBlocks
                .filter(b => dayjs(b.end_time).isAfter(dayjs()))
                .map(b => ({ title: b.title, start: b.start_time, end: b.end_time, type: 'block' as const })),
            ].sort((a, b) => a.start.localeCompare(b.start));
            const next = upcoming[0];
            if (!next) return <Text style={[ss.meta, { color: theme.textSecondary }]}>No upcoming events — tap to see full timeline</Text>;
            const isNow = dayjs(next.start).isBefore(dayjs()) && dayjs(next.end).isAfter(dayjs());
            return (
              <View style={{ gap: 2 }}>
                <Text style={[ss.meta, { color: isNow ? theme.warn : theme.textSecondary, fontWeight: '600' }]}>
                  {isNow ? 'Now: ' : 'Next: '}{next.title}
                </Text>
                <Text style={[ss.meta, { color: theme.textSecondary }]}>
                  {dayjs(next.start).format('h:mm')} – {dayjs(next.end).format('h:mm A')}
                  {upcoming.length > 1 ? ` · ${upcoming.length - 1} more` : ''}
                </Text>
              </View>
            );
          })()}
        </Card>
        </TouchableOpacity>

        <Card style={ss.cardInner}>
          <View style={ss.row}>
            <View style={[ss.badge, { backgroundColor: theme.primaryBg }]}>
              <Text style={[ss.badgeIcon, { color: theme.primary }]}>S</Text>
            </View>
            <Text style={[ss.cardTitle, { color: theme.text }]}>Sleep</Text>
            <View style={[ss.dot, { backgroundColor: sleep.isAsleep ? theme.primary : theme.border }]} />
          </View>
          <Text style={[ss.sub, { color: theme.textSecondary }]}>{sleep.isAsleep ? 'Sleeping' : 'Awake'}</Text>
          <Text style={[ss.big, { color: theme.primary }]}>{sleepDur}</Text>
          {sleep.sleepEnd && (
            <Text style={[ss.meta, { color: theme.textSecondary }]}>Woke at {dayjs(sleep.sleepEnd).format('HH:mm')}</Text>
          )}
        </Card>

        <Card style={ss.cardInner}>
          <View style={ss.row}>
            <View style={[ss.badge, { backgroundColor: theme.primaryBg }]}>
              <Text style={[ss.badgeIcon, { color: theme.primary }]}>H</Text>
            </View>
            <Text style={[ss.cardTitle, { color: theme.text }]}>Hydration</Text>
            <Text style={[ss.pct, { color: theme.primary }]}>{pct}%</Text>
          </View>
          <View style={ss.row}>
            <Text style={[ss.big, { color: theme.primary }]}>{hydration}</Text>
            <Text style={[ss.unit, { color: theme.textSecondary }]}> / {TARGET_ML} ml</Text>
          </View>
          <View style={[ss.track, { backgroundColor: theme.border + '80' }]}>
            <View style={[ss.bar, { width: `${pct}%`, backgroundColor: pct >= 100 ? theme.success : theme.primary }]} />
          </View>
          <Text style={[ss.meta, { color: theme.textSecondary }]}>{Math.max(0, TARGET_ML - hydration)} ml remaining</Text>
          {hydrationReminderEnabled && nextHydrationReminderAt && (
            <Text style={[ss.meta, { color: theme.primary }]}>
              Next reminder: {dayjs(nextHydrationReminderAt).format('h:mm A')}
              {focusEnabled ? ' (paused during focus)' : ''}
            </Text>
          )}
          <View style={ss.row}>
            {QUICK_AMOUNTS.map(ml => (
              <PressableScale
                key={ml}
                style={[ss.chip, { backgroundColor: theme.primaryBg, borderRadius: Radii.chip }]}
                onPress={() => onQuickLog(ml)}
              >
                <Text style={[ss.chipText, { color: theme.primary }]}>+{ml}ml</Text>
              </PressableScale>
            ))}
          </View>
        </Card>

        <Card style={focusEnabled ? [ss.cardInner, { backgroundColor: theme.primaryBg }] : ss.cardInner}>
          <View style={ss.row}>
            <View style={[ss.badge, { backgroundColor: theme.primaryBg }]}>
              <Text style={[ss.badgeIcon, { color: theme.primary }]}>F</Text>
            </View>
            <Text style={[ss.cardTitle, { color: theme.text }]}>Focus Mode</Text>
            <Switch
              value={focusEnabled}
              onValueChange={onToggleFocus}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor="#fff"
            />
          </View>
          {focusEnabled && (
            <>
              <Text style={[ss.sub, { color: theme.primary }]}>{focusRemaining} min remaining</Text>
              <View style={[ss.track, { backgroundColor: theme.border + '80' }]}>
                <View style={[ss.bar, {
                  width: `${Math.round((focusRemaining / (focusDuration || 1)) * 100)}%`,
                  backgroundColor: theme.primary,
                }]} />
              </View>
              {focusStarted && (
                <Text style={[ss.meta, { color: theme.textSecondary }]}>Since {dayjs(focusStarted).format('HH:mm')}</Text>
              )}
            </>
          )}
        </Card>

        {/* Today's Agenda — calendar events + due tasks */}
        <Card style={ss.cardInner}>
          <View style={ss.row}>
            <View style={[ss.badge, { backgroundColor: theme.warnBg }]}>
              <Text style={[ss.badgeIcon, { color: theme.warn }]}>A</Text>
            </View>
            <Text style={[ss.cardTitle, { color: theme.text }]}>Today's Agenda</Text>
            <Text style={[ss.pct, { color: theme.warn }]}>
              {calendarEvents.filter(e => dayjs(e.start_time).isSame(dayjs(), 'day')).length +
                tasks.filter(t => t.status === 'pending' && t.due_date && dayjs(t.due_date).isSame(dayjs(), 'day')).length}
            </Text>
          </View>

          {/* Current time indicator */}
          <View style={[ss.row, { marginVertical: 2 }]}>
            <View style={[ss.nowDot, { backgroundColor: theme.danger }]} />
            <View style={[ss.nowLine, { backgroundColor: theme.danger }]} />
            <Text style={[ss.nowTime, { color: theme.danger }]}>{dayjs().format('h:mm A')}</Text>
          </View>

          {/* All-day events */}
          {calendarEvents
            .filter(e => e.all_day && dayjs(e.start_time).isSame(dayjs(), 'day'))
            .map(e => (
              <View key={e.event_id} style={ss.agendaRow}>
                <View style={[ss.agendaBar, { backgroundColor: theme.warn }]} />
                <View style={ss.agendaContent}>
                  <Text style={[ss.meta, { color: theme.warn, fontWeight: '600' }]}>All day</Text>
                  <Text style={[ss.agendaTitle, { color: theme.text }]} numberOfLines={1}>{e.summary}</Text>
                </View>
              </View>
            ))}

          {/* Timed events */}
          {calendarEvents
            .filter(e => !e.all_day && dayjs(e.start_time).isSame(dayjs(), 'day'))
            .sort((a, b) => a.start_time.localeCompare(b.start_time))
            .map(e => {
              const isPast = dayjs(e.end_time).isBefore(dayjs());
              return (
                <View key={e.event_id} style={[ss.agendaRow, isPast && { opacity: 0.5 }]}>
                  <View style={[ss.agendaBar, { backgroundColor: theme.warn }]} />
                  <View style={ss.agendaContent}>
                    <Text style={[ss.meta, { color: theme.warn, fontWeight: '600' }]}>
                      {dayjs(e.start_time).format('h:mm')} – {dayjs(e.end_time).format('h:mm A')}
                    </Text>
                    <Text style={[ss.agendaTitle, { color: theme.text }]} numberOfLines={1}>{e.summary}</Text>
                    {e.location ? <Text style={[ss.meta, { color: theme.textSecondary }]} numberOfLines={1}>{e.location}</Text> : null}
                  </View>
                </View>
              );
            })}

          {/* Due tasks */}
          {tasks
            .filter(t => t.status === 'pending' && t.due_date && dayjs(t.due_date).isSame(dayjs(), 'day'))
            .map(t => (
              <View key={t.task_id} style={ss.agendaRow}>
                <View style={[ss.agendaBar, { backgroundColor: theme.success }]} />
                <View style={ss.agendaContent}>
                  <Text style={[ss.meta, { color: theme.success, fontWeight: '600' }]}>Task</Text>
                  <Text style={[ss.agendaTitle, { color: theme.text }]} numberOfLines={1}>{t.title}</Text>
                  {t.priority === 'high' && (
                    <Text style={[ss.meta, { color: theme.danger, fontWeight: '600' }]}>High priority</Text>
                  )}
                </View>
              </View>
            ))}

          {/* Empty state */}
          {calendarEvents.filter(e => dayjs(e.start_time).isSame(dayjs(), 'day')).length === 0 &&
            tasks.filter(t => t.status === 'pending' && t.due_date && dayjs(t.due_date).isSame(dayjs(), 'day')).length === 0 && (
              <Text style={[ss.meta, { color: theme.textSecondary }]}>Nothing scheduled today</Text>
            )}
        </Card>

        {isGoogleConnected && (
          <Card style={ss.cardInner}>
            <View style={ss.row}>
              <View style={[ss.badge, { backgroundColor: theme.dangerBg }]}>
                <Text style={[ss.badgeIcon, { color: theme.danger }]}>E</Text>
              </View>
              <Text style={[ss.cardTitle, { color: theme.text }]}>Email</Text>
              {unreadEmailCount > 0 && (
                <View style={[ss.chip, { backgroundColor: theme.danger, paddingVertical: 2, paddingHorizontal: 8 }]}>
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{unreadEmailCount}</Text>
                </View>
              )}
            </View>
            {emails
              .filter(e => e.is_unread)
              .slice(0, 3)
              .map(e => (
                <View key={e.message_id} style={ss.row}>
                  <Text style={[ss.meta, { color: theme.text, flex: 1 }]} numberOfLines={1}>
                    {e.from_address.replace(/<.*>/, '').trim()}
                  </Text>
                  <Text style={[ss.meta, { color: theme.textSecondary, flex: 2 }]} numberOfLines={1}>
                    {e.subject}
                  </Text>
                  {e.category && (
                    <View style={[ss.chip, { backgroundColor: theme.dangerBg, paddingVertical: 1, paddingHorizontal: 6 }]}>
                      <Text style={{ color: theme.danger, fontSize: 10, fontWeight: '600' }}>
                        {e.category === 'action_needed' ? 'action' : e.category}
                      </Text>
                    </View>
                  )}
                </View>
              ))}
            {unreadEmailCount > 3 && (
              <Text style={[ss.meta, { color: theme.textSecondary }]}>+{unreadEmailCount - 3} more unread</Text>
            )}
            {unreadEmailCount === 0 && (
              <Text style={[ss.meta, { color: theme.textSecondary }]}>Inbox zero!</Text>
            )}
          </Card>
        )}

        <Text style={[ss.section, { color: theme.text }]}>Quick Actions</Text>
        <View style={ss.actions}>
          {[
            { label: 'Log Water', bg: theme.primaryBg, fg: theme.primary, onPress: () => onQuickLog(250) },
            { label: 'Add Task', bg: theme.successBg, fg: theme.success, onPress: () => {} },
            { label: 'Focus', bg: theme.primaryBg, fg: theme.primary, onPress: onToggleFocus },
            { label: 'Sync', bg: isOnline ? theme.successBg : theme.warnBg, fg: isOnline ? theme.success : theme.warn, onPress: onSync },
          ].map(a => (
            <PressableScale key={a.label} style={[ss.action, { backgroundColor: a.bg }]} onPress={a.onPress}>
              <View style={[ss.actionDot, { backgroundColor: a.fg }]}>
                <Text style={ss.actionIcon}>{a.label[0]}</Text>
              </View>
              <Text style={[ss.actionLabel, { color: a.fg }]}>{a.label}</Text>
            </PressableScale>
          ))}
        </View>

        {queueCount > 0 && (
          <PressableScale style={[ss.queue, { backgroundColor: theme.warnBg, borderColor: theme.warn }]} onPress={onSync}>
            <View style={[ss.qBadge, { backgroundColor: theme.warn }]}>
              <Text style={ss.qBadgeText}>{queueCount}</Text>
            </View>
            <Text style={[ss.qText, { color: theme.warn }]}>
              event{queueCount > 1 ? 's' : ''} queued
            </Text>
            <Text style={[ss.qRetry, { color: theme.warn }]}>Retry</Text>
          </PressableScale>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Add Habit Modal */}
      <Modal visible={showAddHabit} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={ss.modalBg}>
          <View style={[ss.modal, { backgroundColor: theme.background }]}>
            <Text style={[ss.modalTitle, { color: theme.text }]}>New Habit</Text>
            <TextInput
              style={[ss.modalInput, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
              placeholder="Habit name (e.g. Exercise)"
              placeholderTextColor={theme.textSecondary}
              value={habitName}
              onChangeText={setHabitName}
              autoFocus
            />
            <View style={ss.row}>
              <TextInput
                style={[ss.modalInput, { flex: 1, backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
                placeholder="Icon (emoji)"
                placeholderTextColor={theme.textSecondary}
                value={habitIcon}
                onChangeText={setHabitIcon}
              />
              <TextInput
                style={[ss.modalInput, { flex: 1, backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
                placeholder="Target/day"
                placeholderTextColor={theme.textSecondary}
                value={habitTarget}
                onChangeText={setHabitTarget}
                keyboardType="numeric"
              />
              <TextInput
                style={[ss.modalInput, { flex: 1, backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
                placeholder="Unit"
                placeholderTextColor={theme.textSecondary}
                value={habitUnit}
                onChangeText={setHabitUnit}
              />
            </View>
            <View style={ss.row}>
              <TouchableOpacity style={{ flex: 1, alignItems: 'center', paddingVertical: 14 }} onPress={() => setShowAddHabit(false)}>
                <Text style={[ss.meta, { color: theme.textSecondary, fontWeight: '600', fontSize: 16 }]}>Cancel</Text>
              </TouchableOpacity>
              <PressableScale
                style={[ss.chip, { flex: 2, alignItems: 'center', backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 14 }]}
                onPress={onAddHabit}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Add Habit</Text>
              </PressableScale>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Score Breakdown */}
      <ScoreBreakdownModal
        visible={showScoreBreakdown}
        onClose={() => setShowScoreBreakdown(false)}
        breakdown={scoreBreakdown}
        score={dailyScore}
        streakData={streakData}
      />

      {/* Habit Detail */}
      <HabitDetailModal
        visible={!!showHabitDetail}
        onClose={() => setShowHabitDetail(null)}
        habit={habits.find(h => h.id === showHabitDetail) ?? null}
        stats={showHabitDetail ? getHabitStats(showHabitDetail) : null}
        onDelete={(id) => { deleteHabit(id); setShowHabitDetail(null); }}
      />

      {/* Timeline */}
      <TimelineView
        visible={showTimeline}
        onClose={() => setShowTimeline(false)}
        calendarEvents={calendarEvents}
        timeBlocks={timeBlocks}
      />
    </SafeAreaView>
  );
}

function greeting() {
  const h = dayjs().hour();
  if (h < 6) return 'Good Night';
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  if (h < 21) return 'Good Evening';
  return 'Good Night';
}

// ── Styles (iOS grouped list) ──
const ss = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadText: { ...Typography.callout },
  scroll: { padding: Spacing.screenPadding, paddingBottom: 40 },
  greeting: { ...Typography.largeTitle },
  date: { ...Typography.subhead, marginTop: 2, marginBottom: 20 },
  card: {
    borderRadius: Spacing.groupCornerRadius,
    padding: 16,
    marginBottom: 14,
    gap: 8,
    ...(Platform.OS === 'ios' ? { overflow: 'hidden' } : {}),
  },
  cardInner: { marginBottom: 14, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  badgeIcon: { fontSize: 16, fontWeight: '700' },
  cardTitle: { fontSize: 17, fontWeight: '600', flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  sub: { fontSize: 14, fontWeight: '500' },
  big: { fontSize: 30, fontWeight: '700' },
  unit: { fontSize: 16 },
  meta: { fontSize: 13 },
  pct: { fontSize: 14, fontWeight: '600' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  chipText: { fontSize: 13, fontWeight: '600' },
  section: { ...Typography.headline, marginBottom: 10 },
  actions: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  action: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14, gap: 6 },
  actionDot: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  actionIcon: { color: '#fff', fontWeight: '700', fontSize: 16 },
  actionLabel: { fontSize: 11, fontWeight: '600' },
  offBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 10, gap: 6 },
  offDot: { width: 8, height: 8, borderRadius: 4 },
  offText: { ...Typography.footnote, fontWeight: '600' },
  queue: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  qBadge: { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  qBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  qText: { flex: 1, fontSize: 13, fontWeight: '500' },
  qRetry: { fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  // Agenda styles
  nowDot: { width: 8, height: 8, borderRadius: 4 },
  nowLine: { flex: 1, height: 1.5 },
  nowTime: { fontSize: 11, fontWeight: '600', marginLeft: 4 },
  agendaRow: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  agendaBar: { width: 3, borderRadius: 2, minHeight: 28 },
  agendaContent: { flex: 1, gap: 1 },
  agendaTitle: { fontSize: 14, fontWeight: '500' },
  // Habit styles
  habitRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  habitIcon: { fontSize: 20, width: 28, textAlign: 'center' },
  habitName: { fontSize: 14, fontWeight: '500' },
  habitProgress: { width: 50, height: 6, borderRadius: 3, overflow: 'hidden' },
  habitProgressFill: { height: '100%', borderRadius: 3 },
  habitLogBtn: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  // Modal styles
  modalBg: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' },
  modal: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  modalTitle: { fontSize: 22, fontWeight: '700' },
  modalInput: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
  surface: {},
});
