import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import dayjs from 'dayjs';
import { useRouter } from 'expo-router';
import { useStore, Task, UserProfile } from '../store/useStore';
import { useHaptics } from '../hooks/useHaptics';
import { useAppTheme } from '../hooks/useAppTheme';
import { PressableScale } from '@/components/PressableScale';
import { Card } from '@/src/components/Card';
import { InsightsCard } from '@/src/components/InsightsCard';
import { ScreenContainer, Section } from '@/src/components/layout';
import { Typography } from '@/constants/theme';
import { run } from '../agent/agent';
import {
  computeBMR,
  computeTDEE,
  computeTargetCalories,
  ageFromBirthDate,
  type ActivityLevel,
} from '../utils/meProfileCalculations';
import { buildFitnessCoachMealPrompt } from '../prompts/mealPlanPrompts';

const ESSENTIALS = ['Brush teeth', 'Bath', 'Healthy breakfast'] as const;
const WATER_QUICK = [250, 500] as const;

export default function HomeScreen(): React.ReactElement {
  const { theme } = useAppTheme();
  const haptic = useHaptics();
  const router = useRouter();

  const ready = useStore((s) => s.ready);
  const init = useStore((s) => s.init);
  const tasks = useStore((s) => s.tasks);
  const addTask = useStore((s) => s.addTask);
  const updateTask = useStore((s) => s.updateTask);
  const hydrationTodayMl = useStore((s) => s.hydrationTodayMl);
  const hydrationGoalMl = useStore((s) => s.hydrationGoalMl || 2500);
  const logHydration = useStore((s) => s.logHydration);
  const setHydrationReminder = useStore((s) => s.setHydrationReminder);
  const sleep = useStore((s) => s.sleep);
  const setSleep = useStore((s) => s.setSleep);
  const addSleepSession = useStore((s) => s.addSleepSession);
  const userProfile = useStore((s) => s.userProfile as UserProfile | null);

  const [mealPlanLoading, setMealPlanLoading] = useState(false);
  const [mealCoachText, setMealCoachText] = useState<string | null>(null);

  const coachTargetCalories = useMemo(() => {
    const u = userProfile;
    if (!u || u.weight_kg == null || u.height_cm == null) return undefined;
    const age = ageFromBirthDate(u.birth_date ?? null);
    const g = (u.gender as 'male' | 'female' | 'other') ?? 'male';
    const al = (u.activity_level as ActivityLevel) ?? 'moderate';
    const bmr = computeBMR(u.weight_kg, u.height_cm, age, g);
    const tdee = computeTDEE(bmr, al);
    const gt = (u.goal_type as 'gain' | 'lose' | 'maintain') ?? 'maintain';
    return computeTargetCalories(
      tdee,
      gt,
      u.weight_kg,
      u.target_weight_kg ?? null,
      u.target_date ?? null,
    );
  }, [userProfile]);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!ready) return;
    ensureEssentialsForToday(tasks, addTask).catch(() => {});
  }, [ready, tasks, addTask]);

  const todayEssentials = useMemo(() => {
    const today = dayjs().format('YYYY-MM-DD');
    const todayTasks = tasks.filter(
      (t) => t.due_date && dayjs(t.due_date).format('YYYY-MM-DD') === today,
    );
    // One row per essential, in a fixed morning order; avoids DB order + duplicate rows.
    const used = new Set<string>();
    const ordered: Task[] = [];
    for (const e of ESSENTIALS) {
      const match = todayTasks.find(
        (t) => !used.has(t.task_id) && t.title.toLowerCase().includes(e.toLowerCase()),
      );
      if (match) {
        used.add(match.task_id);
        ordered.push(match);
      }
    }
    return ordered;
  }, [tasks]);

  const completedCount = todayEssentials.filter((t) => t.status === 'completed').length;
  const pendingCount = todayEssentials.length - completedCount;
  const hydrationPct = Math.min(100, Math.round((hydrationTodayMl / hydrationGoalMl) * 100));

  if (!ready) {
    return (
      <SafeAreaView style={[ss.fill, { backgroundColor: theme.background }]} edges={['top', 'left', 'right', 'bottom']}>
        <View style={ss.center}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[ss.loadText, { color: theme.textSecondary }]}>Preparing your day…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <ScreenContainer scroll>
      <Card variant="elevated" style={ss.card}>
        <Text style={[ss.title, { color: theme.text }]}>{greeting()}</Text>
        <Text style={[ss.sub, { color: theme.textSecondary }]}>
          Let’s keep today simple: sleep well, do essentials, hydrate, and eat healthy.
        </Text>
      </Card>

      <Section title="Sleep routine">
        <Card variant="outlined" style={ss.card}>
          <Text style={[ss.meta, { color: theme.textSecondary }]}>
            Sleep start: {sleep.sleepStart ? dayjs(sleep.sleepStart).format('h:mm A') : 'Not set'}
          </Text>
          <Text style={[ss.meta, { color: theme.textSecondary }]}>
            Wake time: {sleep.sleepEnd ? dayjs(sleep.sleepEnd).format('h:mm A') : 'Not set'}
          </Text>
          <View style={ss.row}>
            <PressableScale
              style={[ss.btn, { backgroundColor: theme.primaryBg }]}
              onPress={() => {
                setSleep({ isAsleep: true, sleepStart: dayjs().toISOString(), sleepEnd: null, durationMinutes: 0 });
                haptic.success();
              }}
            >
              <Text style={[ss.btnText, { color: theme.primary }]}>Set sleep now</Text>
            </PressableScale>
            <PressableScale
              style={[ss.btn, { backgroundColor: theme.warnBg }]}
              onPress={async () => {
                if (!sleep.sleepStart) return;
                const end = dayjs().toISOString();
                const mins = dayjs(end).diff(dayjs(sleep.sleepStart), 'minute');
                setSleep({ isAsleep: false, sleepEnd: end, durationMinutes: mins });
                await addSleepSession(sleep.sleepStart, end, mins);
                haptic.success();
              }}
            >
              <Text style={[ss.btnText, { color: theme.warn }]}>Set wake now</Text>
            </PressableScale>
          </View>
        </Card>
      </Section>

      <Section title="Daily essentials">
        <Card variant="outlined" style={ss.card}>
          {todayEssentials.map((task: Task) => (
            <PressableScale
              key={task.task_id}
              style={[ss.taskRow, { borderColor: theme.border, backgroundColor: task.status === 'completed' ? theme.successBg : theme.surface }]}
              onPress={async () => {
                await updateTask(task.task_id, { status: task.status === 'completed' ? 'pending' : 'completed' });
                haptic.success();
              }}
            >
              <Text style={[ss.taskText, { color: task.status === 'completed' ? theme.success : theme.text }]}>
                {task.status === 'completed' ? '✓' : '○'} {task.title}
              </Text>
            </PressableScale>
          ))}
          <Text style={[ss.meta, { color: theme.textSecondary, marginTop: 8 }]}>
            {completedCount === todayEssentials.length && todayEssentials.length > 0
              ? 'Great discipline today. Proud of you.'
              : dayjs().hour() >= 20 && pendingCount > 0
                ? `You still have ${pendingCount} pending. Let’s finish strong before sleep.`
                : `${completedCount}/${todayEssentials.length} completed.`}
          </Text>
        </Card>
      </Section>

      <Section title="Hydration & breakfast">
        <Card variant="outlined" style={ss.card}>
          <Text style={[ss.meta, { color: theme.textSecondary }]}>
            Water: {hydrationTodayMl} / {hydrationGoalMl} ml ({hydrationPct}%)
          </Text>
          <View style={[ss.track, { backgroundColor: theme.border }]}>
            <View style={[ss.bar, { width: `${hydrationPct}%`, backgroundColor: theme.primary }]} />
          </View>
          <View style={ss.row}>
            {WATER_QUICK.map((ml) => (
              <PressableScale key={ml} style={[ss.btn, { backgroundColor: theme.primaryBg }]} onPress={() => logHydration(ml)}>
                <Text style={[ss.btnText, { color: theme.primary }]}>+{ml} ml</Text>
              </PressableScale>
            ))}
          </View>
          <PressableScale
            style={[ss.secondaryBtn, { borderColor: theme.border }]}
            onPress={() => {
              setHydrationReminder(7, 22, hydrationGoalMl, 90);
              haptic.success();
            }}
          >
            <Text style={[ss.secondaryBtnText, { color: theme.textSecondary }]}>Enable drink-water reminders</Text>
          </PressableScale>
        </Card>
      </Section>

      <Section title="Fitness coach">
        <Card variant="elevated" style={ss.card}>
          <Text style={[ss.meta, { color: theme.textSecondary }]}>
            Add your body details in Me. Then get a structured meal + exercise coach plan.
          </Text>
          <View style={ss.row}>
            <PressableScale style={[ss.btn, { backgroundColor: theme.primaryBg }]} onPress={() => router.push('/me')}>
              <Text style={[ss.btnText, { color: theme.primary }]}>Open Me profile</Text>
            </PressableScale>
            <PressableScale
              style={[ss.btn, { backgroundColor: theme.primary }]}
              onPress={async () => {
                setMealPlanLoading(true);
                try {
                  const profileText = userProfile
                    ? `weight ${userProfile.weight_kg ?? 'unknown'}kg, height ${userProfile.height_cm ?? 'unknown'}cm, goal ${userProfile.goal_type ?? 'maintain'}`
                    : 'profile incomplete';
                  const prompt = buildFitnessCoachMealPrompt(profileText, coachTargetCalories);
                  const result = await run(prompt, [], {});
                  setMealCoachText(result.output || 'No plan generated yet.');
                } finally {
                  setMealPlanLoading(false);
                }
              }}
            >
              <Text style={ss.primaryBtnText}>{mealPlanLoading ? 'Building…' : 'Generate coach plan'}</Text>
            </PressableScale>
          </View>
          {mealCoachText ? <Text style={[ss.coachText, { color: theme.text }]}>{mealCoachText}</Text> : null}
        </Card>
      </Section>
      <InsightsCard />
    </ScreenContainer>
  );
}

async function ensureEssentialsForToday(tasks: Task[], addTask: (title: string, priority?: 'low' | 'medium' | 'high', dueDate?: string | null, notes?: string, recurrence?: string | null) => Promise<void>) {
  const todayDue = dayjs().endOf('day').toISOString();
  for (const title of ESSENTIALS) {
    const exists = tasks.some(
      (t) => t.title.toLowerCase() === title.toLowerCase() && t.due_date && dayjs(t.due_date).isSame(dayjs(), 'day'),
    );
    if (!exists) {
      await addTask(title, 'medium', todayDue, 'Daily essential', 'daily');
    }
  }
}

function greeting() {
  const h = dayjs().hour();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const ss = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  loadText: { ...Typography.callout },
  card: { marginBottom: 12, gap: 8 },
  title: { ...Typography.largeTitle },
  sub: { ...Typography.body, lineHeight: 22 },
  row: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 20, alignItems: 'center' },
  btnText: { fontSize: 13, fontWeight: '600' },
  primaryBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  secondaryBtn: { marginTop: 6, borderWidth: 1, borderRadius: 20, paddingVertical: 10, alignItems: 'center' },
  secondaryBtnText: { fontSize: 13, fontWeight: '600' },
  meta: { fontSize: 13 },
  taskRow: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  taskText: { fontSize: 14, fontWeight: '600' },
  track: { height: 8, borderRadius: 6, overflow: 'hidden', marginTop: 6, marginBottom: 10 },
  bar: { height: '100%' },
  coachText: { marginTop: 10, fontSize: 13, lineHeight: 20 },
});
