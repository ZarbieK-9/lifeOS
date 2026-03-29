// PicoClaw Agent — Reflection Engine + Evening Coach
// Daily self-assessment with causal analysis and behavior suggestions (deterministic).

import dayjs from 'dayjs';
import { getDatabase, uid } from '../db/database';
import { useStore } from '../store/useStore';
import type { GoalDomain } from './types';

// ── Types ─────────────────────────────────────────

export interface CausalInsight {
  observation: string;
  likelyCause: string;
  evidence: string;
}

export interface CoachingSuggestion {
  suggestion: string;
  reason: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface Reflection {
  period: 'daily' | 'weekly';
  date: string;
  goalsProgress: GoalReflection[];
  domainSummaries: DomainSummary[];
  insights: string[];
  adjustments: string[];
  score: number;
  causalInsights: CausalInsight[];
  coachingSuggestion: CoachingSuggestion | null;
  commitmentCheck: string | null;
}

interface GoalReflection {
  goalId: string;
  title: string;
  domain: GoalDomain;
  delta: number;
  currentValue: number;
  targetValue: number | null;
  pct: number;
  onTrack: boolean;
}

interface DomainSummary {
  domain: GoalDomain;
  highlights: string[];
}

function buildCausalAnalysis(
  state: ReturnType<typeof useStore.getState>,
  now: dayjs.Dayjs,
  completedToday: number,
  hydPct: number,
): { causal: CausalInsight[]; suggestion: CoachingSuggestion | null } {
  const causal: CausalInsight[] = [];
  let suggestion: CoachingSuggestion | null = null;

  const todayEvents = state.calendarEvents.filter((e) => dayjs(e.start_time).isSame(now, 'day') && !e.all_day)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  let backToBackAfternoon = false;
  for (let i = 0; i < todayEvents.length - 1; i++) {
    const a = todayEvents[i];
    const b = todayEvents[i + 1];
    const aStart = dayjs(a.start_time).hour();
    if (aStart >= 14) {
      const gap = dayjs(b.start_time).diff(dayjs(a.end_time), 'minute');
      if (gap >= 0 && gap < 15) {
        backToBackAfternoon = true;
        break;
      }
    }
  }

  if (completedToday === 0 && state.tasks.filter((t) => t.status === 'pending').length > 0) {
    if (backToBackAfternoon) {
      causal.push({
        observation: 'You completed 0 tasks after midday.',
        likelyCause: 'Back-to-back meetings in the afternoon may have left no focus window.',
        evidence: 'This pattern matches cramped calendar gaps today.',
      });
      suggestion = {
        suggestion: 'Block 30 minutes after your last meeting for task catch-up.',
        reason: 'You lose momentum when meetings end and nothing is scheduled.',
        difficulty: 'easy',
      };
    } else {
      causal.push({
        observation: 'No tasks checked off today despite open items.',
        likelyCause: 'Energy or unclear next step on the hardest task.',
        evidence: 'Low completion with pending backlog.',
      });
      suggestion = {
        suggestion: 'Tomorrow, spend 10 minutes on the smallest pending task first.',
        reason: 'A quick win builds momentum before harder work.',
        difficulty: 'easy',
      };
    }
  }

  if (hydPct < 50 && todayEvents.length >= 3) {
    causal.push({
      observation: `Hydration only ${hydPct}% with a busy calendar.`,
      likelyCause: 'Meetings reduce natural water breaks.',
      evidence: 'Hydration often trails on high meeting days.',
    });
    if (!suggestion) {
      suggestion = {
        suggestion: 'Keep a full bottle visible before your first meeting.',
        reason: 'Visual cues beat memory when you are back-to-back.',
        difficulty: 'easy',
      };
    }
  }

  // ── Poor sleep → low task completion ──────────
  const lastSleep = state.sleepSessions[0];
  if (lastSleep && lastSleep.duration_minutes < 360 && completedToday < 2) {
    causal.push({
      observation: `Only ${completedToday} task(s) completed with ${Math.round(lastSleep.duration_minutes / 60)}h sleep.`,
      likelyCause: 'Short sleep often reduces next-day focus and task throughput.',
      evidence: 'Sleep < 6h correlates with lower completion in your data.',
    });
    if (!suggestion) {
      suggestion = {
        suggestion: 'Aim for lights-out 30 minutes earlier tonight.',
        reason: 'Even a small sleep gain compounds into better focus.',
        difficulty: 'easy',
      };
    }
  }

  // ── Skipped habits → low mood ───────────────────
  const todayMood = state.moodLogs?.find((m: any) => dayjs(m.logged_at).isSame(dayjs(), 'day'));
  const enabledHabits = state.habits?.filter((h: any) => h.enabled) ?? [];
  const todayStr = dayjs().format('YYYY-MM-DD');
  const missedHabits = enabledHabits.filter((h: any) => {
    const logged = (state.habitLogs ?? []).filter(
      (l: any) => l.habit_id === h.id && dayjs(l.logged_at).format('YYYY-MM-DD') === todayStr,
    );
    return logged.reduce((s: number, l: any) => s + (l.value ?? 0), 0) < (h.target_per_day ?? 1);
  });
  if (missedHabits.length > 2 && todayMood && todayMood.mood <= 2) {
    causal.push({
      observation: `Mood ${todayMood.mood}/5 with ${missedHabits.length} habits incomplete.`,
      likelyCause: 'Skipped routines can erode sense of control.',
      evidence: 'Low mood days often have more missed habits.',
    });
  }

  // ── High spending → budget stress ───────────────
  const spendPattern = state.patterns.find((p: any) => p.description === 'spending_habits');
  const avgDaily = spendPattern ? ((spendPattern.data as any).avgDaily ?? 0) : 0;
  if (avgDaily > 0 && state.todaySpend > avgDaily * 2 && todayMood && todayMood.mood <= 3) {
    causal.push({
      observation: `Spent $${state.todaySpend.toFixed(0)} (2x+ your average) on a low-mood day.`,
      likelyCause: 'Stress spending or unexpected costs may compound unease.',
      evidence: 'High-spend + low-mood days cluster in your history.',
    });
  }

  return { causal, suggestion };
}

// ── Daily reflection ──────────────────────────────

export async function generateDailyReflection(): Promise<Reflection> {
  const db = await getDatabase();
  const state = useStore.getState();
  const today = dayjs().format('YYYY-MM-DD');
  const now = dayjs();
  const yesterday = now.subtract(1, 'day').format('YYYY-MM-DD');

  const insights: string[] = [];
  const adjustments: string[] = [];
  const domainSummaries: DomainSummary[] = [];

  const healthHighlights: string[] = [];
  const hydGoal = state.hydrationGoalMl || 2500;
  const hydPct = Math.round((state.hydrationTodayMl / hydGoal) * 100);
  healthHighlights.push(`Hydration: ${state.hydrationTodayMl}ml/${hydGoal}ml (${hydPct}%)`);
  if (hydPct < 80) {
    insights.push(`Hydration was only ${hydPct}% today.`);
    adjustments.push('Consider setting earlier reminders or keeping water visible.');
  }

  const todayMood = state.moodLogs.find((m) => dayjs(m.logged_at).isSame(now, 'day'));
  if (todayMood) {
    healthHighlights.push(`Mood: ${todayMood.mood}/5, Energy: ${todayMood.energy}/5`);
    if (todayMood.energy <= 2) {
      insights.push(`You rated energy ${todayMood.energy}/5 today. What drained you?`);
      adjustments.push('Note one drain — your coach uses it for weekly patterns.');
    }
  }

  const lastSleep = state.sleepSessions[0];
  if (lastSleep && dayjs(lastSleep.sleep_end).isSame(now, 'day')) {
    const hrs = Math.round((lastSleep.duration_minutes / 60) * 10) / 10;
    healthHighlights.push(`Sleep: ${hrs}h`);
    if (hrs < 7) {
      insights.push(`Only ${hrs}h of sleep last night.`);
      adjustments.push('Try winding down 30 minutes earlier tomorrow.');
    }
  } else if (lastSleep) {
    const hrs = Math.round((lastSleep.duration_minutes / 60) * 10) / 10;
    healthHighlights.push(`Last sleep logged: ${hrs}h`);
  }

  domainSummaries.push({ domain: 'health', highlights: healthHighlights });

  const prodHighlights: string[] = [];
  const completedToday = state.tasks.filter(
    (t) => t.status === 'completed' && t.updated_at && dayjs(t.updated_at).isSame(now, 'day'),
  ).length;
  const pendingCount = state.tasks.filter((t) => t.status === 'pending').length;
  prodHighlights.push(`Tasks: ${completedToday} completed, ${pendingCount} remaining`);

  if (completedToday === 0 && pendingCount > 0) {
    insights.push('No tasks completed today.');
    adjustments.push('Start tomorrow with one quick win to build momentum.');
  } else if (completedToday >= 5) {
    insights.push(`Strong productivity day — ${completedToday} tasks done!`);
  }

  domainSummaries.push({ domain: 'productivity', highlights: prodHighlights });

  const finHighlights: string[] = [];
  finHighlights.push(`Spent: $${state.todaySpend.toFixed(2)} today, $${state.monthSpend.toFixed(2)} this month`);
  const spendingPattern = state.patterns.find((p) => p.description === 'spending_habits');
  if (spendingPattern) {
    const avg = (spendingPattern.data as { avgDaily?: number }).avgDaily ?? 0;
    if (avg > 0 && state.todaySpend > avg * 1.5) {
      insights.push(`Spending was ${Math.round(state.todaySpend / avg)}x your daily average — mindful or intentional?`);
    }
  }
  domainSummaries.push({ domain: 'finance', highlights: finHighlights });

  const socialHighlights: string[] = [];
  const unreadCount = state.emails.filter((e) => e.is_unread).length;
  socialHighlights.push(`${unreadCount} unread email${unreadCount !== 1 ? 's' : ''}`);
  domainSummaries.push({ domain: 'social', highlights: socialHighlights });

  const goalsProgress: GoalReflection[] = [];
  for (const goal of state.goals.filter((g) => g.status === 'active')) {
    const pct = goal.targetValue ? Math.round((goal.currentValue / goal.targetValue) * 100) : 0;
    goalsProgress.push({
      goalId: goal.id,
      title: goal.title,
      domain: goal.domain,
      delta: 0,
      currentValue: goal.currentValue,
      targetValue: goal.targetValue,
      pct,
      onTrack: pct >= 50 || !goal.deadline || dayjs(goal.deadline).isAfter(now),
    });
  }

  let score = 50;
  score += Math.min(20, hydPct / 5);
  score += Math.min(15, completedToday * 3);
  if (lastSleep) {
    const hrs = lastSleep.duration_minutes / 60;
    score += hrs >= 7 ? 10 : hrs >= 6 ? 5 : 0;
  }
  if (todayMood) score += todayMood.mood >= 4 ? 5 : todayMood.mood >= 3 ? 2 : 0;
  score = Math.min(100, Math.max(0, Math.round(score)));

  const { causal: causalInsights, suggestion: coachingSuggestion } = buildCausalAnalysis(state, now, completedToday, hydPct);

  let commitmentCheck: string | null = null;
  try {
    const yCommit = await db.getFirstAsync<{ suggestion: string; adopted: number }>(
      "SELECT suggestion, adopted FROM coaching_commitments WHERE date_suggested = ? ORDER BY created_at DESC LIMIT 1",
      [yesterday],
    );
    if (yCommit) {
      commitmentCheck =
        yCommit.adopted === 1
          ? `Yesterday you tried: "${yCommit.suggestion.slice(0, 120)}${yCommit.suggestion.length > 120 ? '…' : ''}" — nice follow-through.`
          : `Yesterday I suggested: "${yCommit.suggestion.slice(0, 120)}${yCommit.suggestion.length > 120 ? '…' : ''}" — did you try it?`;
    }
  } catch { /* ignore */ }

  if (coachingSuggestion) {
    try {
      const existing = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM coaching_commitments WHERE date_suggested = ? LIMIT 1",
        [today],
      );
      if (!existing) {
        const id = uid();
        await db.runAsync(
          "INSERT INTO coaching_commitments (id, suggestion, reason, date_suggested, date_due, adopted, outcome, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, datetime('now'))",
          [
            id,
            coachingSuggestion.suggestion,
            coachingSuggestion.reason,
            today,
            dayjs().add(1, 'day').format('YYYY-MM-DD'),
            null,
          ],
        );
        await state.loadCoachingCommitments().catch(() => {});
      }
    } catch { /* ignore */ }
  }

  return {
    period: 'daily',
    date: today,
    goalsProgress,
    domainSummaries,
    insights,
    adjustments,
    score,
    causalInsights,
    coachingSuggestion,
    commitmentCheck,
  };
}

// ── Weekly reflection ─────────────────────────────

export async function generateWeeklyReflection(): Promise<Reflection> {
  const db = await getDatabase();
  const state = useStore.getState();
  const now = dayjs();
  const weekStart = now.subtract(7, 'day').format('YYYY-MM-DD');

  const insights: string[] = [];
  const adjustments: string[] = [];

  const streaks = await db.getAllAsync<{ date: string; score: number }>(
    "SELECT date, score FROM daily_streaks WHERE date >= ? ORDER BY date",
    [weekStart],
  );
  const avgScore = streaks.length > 0
    ? Math.round(streaks.reduce((s, r) => s + r.score, 0) / streaks.length)
    : 0;

  if (avgScore >= 70) {
    insights.push(`Great week! Average daily score: ${avgScore}/100.`);
  } else if (avgScore >= 40) {
    insights.push(`Decent week. Average daily score: ${avgScore}/100.`);
    adjustments.push('Focus on consistency — small daily wins compound.');
  } else {
    insights.push(`Tough week. Average daily score: ${avgScore}/100.`);
    adjustments.push('Pick one domain to focus on this coming week. Small steps.');
  }

  const weekTasks = await db.getFirstAsync<{ total: number; completed: number }>(
    "SELECT COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed FROM tasks WHERE created_at >= ?",
    [weekStart],
  );
  if (weekTasks && weekTasks.total > 0) {
    const rate = Math.round(((weekTasks.completed ?? 0) / weekTasks.total) * 100);
    insights.push(`Task completion: ${weekTasks.completed}/${weekTasks.total} (${rate}%).`);
  }

  const goalsProgress: GoalReflection[] = state.goals
    .filter((g) => g.status === 'active')
    .map((g) => ({
      goalId: g.id,
      title: g.title,
      domain: g.domain,
      delta: 0,
      currentValue: g.currentValue,
      targetValue: g.targetValue,
      pct: g.targetValue ? Math.round((g.currentValue / g.targetValue) * 100) : 0,
      onTrack: true,
    }));

  return {
    period: 'weekly',
    date: now.format('YYYY-MM-DD'),
    goalsProgress,
    domainSummaries: [],
    insights,
    adjustments,
    score: avgScore,
    causalInsights: [],
    coachingSuggestion: null,
    commitmentCheck: null,
  };
}

export function formatReflection(r: Reflection): string {
  const lines: string[] = [];

  if (r.period === 'daily') {
    lines.push(`📊 Daily Reflection (Score: ${r.score}/100)`);
  } else {
    lines.push(`📊 Weekly Reflection (Avg Score: ${r.score}/100)`);
  }

  for (const ds of r.domainSummaries) {
    lines.push(`**${ds.domain}:** ${ds.highlights.join(' | ')}`);
  }

  if (r.goalsProgress.length > 0) {
    lines.push('');
    for (const g of r.goalsProgress) {
      const status = g.onTrack ? '✓' : '⚠';
      lines.push(`${status} ${g.title}: ${g.pct}%`);
    }
  }

  if (r.causalInsights.length > 0) {
    lines.push('');
    lines.push('**What happened:**');
    for (const c of r.causalInsights) {
      lines.push(`• ${c.observation} ${c.likelyCause} (${c.evidence})`);
    }
  }

  if (r.commitmentCheck) {
    lines.push('');
    lines.push(`**${r.commitmentCheck}**`);
  }

  if (r.coachingSuggestion) {
    lines.push('');
    lines.push(`**Try tomorrow:** ${r.coachingSuggestion.suggestion} (${r.coachingSuggestion.difficulty})`);
    lines.push(`_Why:_ ${r.coachingSuggestion.reason}`);
  }

  if (r.insights.length > 0) {
    lines.push('');
    lines.push('**Insights:** ' + r.insights.join(' '));
  }

  if (r.adjustments.length > 0) {
    lines.push('**Suggestions:** ' + r.adjustments.join(' '));
  }

  return lines.join('\n');
}

/** Evening coach notification body (conversational). */
export function formatEveningCoach(r: Reflection): string {
  const parts: string[] = [`Evening check-in — score ${r.score}/100.`];
  if (r.commitmentCheck) parts.push(r.commitmentCheck);
  if (r.causalInsights[0]) {
    const c = r.causalInsights[0];
    parts.push(`${c.observation} ${c.likelyCause}`);
  }
  if (r.coachingSuggestion) {
    parts.push(`Coach note: ${r.coachingSuggestion.suggestion}`);
  } else if (r.adjustments[0]) {
    parts.push(r.adjustments[0]);
  }
  return parts.join('\n');
}
