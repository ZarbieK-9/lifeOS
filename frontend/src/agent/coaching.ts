// Intelligent Daily Coach — morning plan, weekly review, template helpers.
// Deterministic; no LLM.

import dayjs from 'dayjs';
import { kv } from '../db/mmkv';
import { useStore } from '../store/useStore';
import type { GoalDomain } from './types';

export interface ScheduleBlock {
  start: string;
  end: string;
  label: string;
  type: 'event' | 'task' | 'suggestion';
}

export interface MorningPlan {
  greeting: string;
  energyCheck: boolean;
  topPriorities: string[];
  schedule: ScheduleBlock[];
  risks: string[];
  coachNote: string;
  /** Emails needing action — morning planning only */
  actionEmailCount?: number;
}

export interface WeeklyReview {
  weekScore: number;
  trend: 'improving' | 'stable' | 'declining';
  trendData: number[];
  topWin: string;
  topChallenge: string;
  correlations: string[];
  nextWeekFocus: string;
  commitmentReview: string;
}

const MORNING_PLAN_KEY = 'coach_morning_plan_json';
const MORNING_PLAN_DATE_KEY = 'coach_morning_plan_date';

export function persistMorningPlan(plan: MorningPlan): void {
  const today = dayjs().format('YYYY-MM-DD');
  kv.set(MORNING_PLAN_DATE_KEY, today);
  kv.set(MORNING_PLAN_KEY, JSON.stringify(plan));
}

export function loadMorningPlanForToday(): MorningPlan | null {
  const today = dayjs().format('YYYY-MM-DD');
  if (kv.getString(MORNING_PLAN_DATE_KEY) !== today) return null;
  const raw = kv.getString(MORNING_PLAN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MorningPlan;
  } catch {
    return null;
  }
}

/** Build coach note from learned patterns (deterministic). */
function buildCoachNote(state: ReturnType<typeof useStore.getState>, hour: number): string {
  const patterns = state.patterns;
  const prodBeforeNoon = patterns.find((p) => p.description === 'task_completion_time');
  if (prodBeforeNoon && hour < 12) {
    const ratio = (prodBeforeNoon.data as { morningRatio?: number })?.morningRatio;
    if (ratio != null && ratio > 0.55) {
      return "You're most productive before noon — front-load your hardest task if you can.";
    }
  }
  const sleepMood = patterns.find((p) => p.description === 'sleep_mood_correlation');
  if (sleepMood) {
    return 'Good rest fuels a good day — even a short wind-down last night helps today\'s focus.';
  }
  const hyd = patterns.find((p) => p.description === 'hydration_time_clusters');
  if (hyd) {
    const hours = (hyd.data as { hours?: number[] }).hours ?? [];
    if (hours.length > 0) {
      return `You often hydrate around ${hours.slice(0, 2).map((h) => `${h}:00`).join(' and ')} — stacking water with those habits keeps energy steadier.`;
    }
  }
  return 'Small wins early build momentum. Pick one priority and finish it before lunch.';
}

function backToBackRisk(): string[] {
  const state = useStore.getState();
  const today = dayjs();
  const risks: string[] = [];
  const timed = state.calendarEvents
    .filter((e) => !e.all_day && dayjs(e.start_time).isSame(today, 'day'))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  for (let i = 0; i < timed.length - 1; i++) {
    const a = timed[i];
    const b = timed[i + 1];
    const gapMin = dayjs(b.start_time).diff(dayjs(a.end_time), 'minute');
    if (gapMin >= 0 && gapMin < 10) {
      risks.push(`Back-to-back: ${a.summary} → ${b.summary} — hydrate or stretch between them.`);
      break;
    }
  }
  return risks;
}

export async function generateMorningPlan(): Promise<MorningPlan> {
  const state = useStore.getState();
  const now = dayjs();
  const today = now.format('YYYY-MM-DD');
  const hour = now.hour();
  const greeting =
    hour < 12 ? 'Good morning! Here\'s your day.' : hour < 17 ? 'Good afternoon — here\'s what\'s ahead.' : 'Good evening — quick plan check.';

  const todayMood = state.moodLogs.find((m) => dayjs(m.logged_at).isSame(now, 'day'));
  const energyCheck = !todayMood;

  const pending = state.tasks.filter((t) => t.status === 'pending');
  const dueToday = pending.filter((t) => t.due_date && dayjs(t.due_date).isSame(now, 'day'));
  const sorted = [...pending].sort((a, b) => {
    const pri = { high: 3, medium: 2, low: 1 } as const;
    const d = (pri[b.priority] ?? 0) - (pri[a.priority] ?? 0);
    if (d !== 0) return d;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
  const topPriorities = sorted.slice(0, 3).map((t) => t.title);

  const schedule: ScheduleBlock[] = [];
  for (const e of state.calendarEvents.filter((ev) => dayjs(ev.start_time).isSame(now, 'day')).slice(0, 8)) {
    schedule.push({
      start: e.start_time,
      end: e.end_time,
      label: e.summary,
      type: 'event',
    });
  }
  for (const t of dueToday.slice(0, 3)) {
    schedule.push({
      start: '',
      end: '',
      label: t.title,
      type: 'task',
    });
  }

  const risks: string[] = [...backToBackRisk()];

  const lastSleep = state.sleepSessions[0];
  if (lastSleep && dayjs(lastSleep.sleep_end).isSame(now.subtract(1, 'day'), 'day')) {
    const hrs = lastSleep.duration_minutes / 60;
    if (hrs > 0 && hrs < 6) {
      risks.push('You had under 6h sleep — pace yourself and protect one focus block.');
    }
  }

  const overdue = pending.filter((t) => t.due_date && dayjs(t.due_date).isBefore(now, 'day'));
  if (overdue.length > 0) {
    risks.push(`${overdue.length} overdue task(s) — consider triaging or rescheduling one today.`);
  }

  const actionEmails = state.emails.filter((e) => e.category === 'action_needed');
  const actionEmailCount = actionEmails.length;

  let coachNote = buildCoachNote(state, hour);
  const prof = state.userProfile;
  if (prof?.day_outline?.trim()) {
    const snippet = prof.day_outline.trim().slice(0, 220);
    coachNote = `Your normal day: ${snippet}${prof.day_outline.length > 220 ? "…" : ""} — ${coachNote}`;
  }
  if (prof?.activity_prefs?.trim()) {
    coachNote += ` · Protect: ${prof.activity_prefs.trim().slice(0, 100)}${prof.activity_prefs.length > 100 ? "…" : ""}`;
  }

  if (prof?.typical_wake_time) {
    schedule.push({
      start: "",
      end: "",
      label: `Wake ~${prof.typical_wake_time}`,
      type: "suggestion",
    });
  }
  if (prof?.leave_home_time) {
    schedule.push({
      start: "",
      end: "",
      label: `Leave home ~${prof.leave_home_time}`,
      type: "suggestion",
    });
  }
  if (prof?.work_start_time) {
    schedule.push({
      start: "",
      end: "",
      label: `At work / first commitment ~${prof.work_start_time}`,
      type: "suggestion",
    });
  }
  if (prof?.typical_bedtime) {
    schedule.push({
      start: "",
      end: "",
      label: `Wind down toward ~${prof.typical_bedtime}`,
      type: "suggestion",
    });
  }

  let workT: dayjs.Dayjs | null = null;
  if (prof?.work_start_time) {
    const m = prof.work_start_time.match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
      workT = dayjs(`${today}T${m[1].padStart(2, "0")}:${m[2]}:00`);
    }
  }
  if (workT?.isValid()) {
    const first = state.calendarEvents
      .filter((e) => !e.all_day && dayjs(e.start_time).isSame(now, "day"))
      .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
    if (first && dayjs(first.start_time).isBefore(workT)) {
      risks.push(
        `First calendar block (${first.summary}) is before your usual work start (${prof?.work_start_time}) — adjust or leave earlier.`,
      );
    }
  }

  return {
    greeting,
    energyCheck,
    topPriorities,
    schedule,
    risks,
    coachNote,
    actionEmailCount,
  };
}

export function formatMorningPlanNotificationBody(p: MorningPlan): string {
  const lines: string[] = [p.greeting];
  if (p.energyCheck) lines.push('Energy check: log how you feel to plan your day better.');
  if (p.topPriorities.length > 0) lines.push(`Priorities: ${p.topPriorities.join(' · ')}`);
  else lines.push('No open tasks — great time for deep work or planning.');
  if (typeof p.actionEmailCount === 'number' && p.actionEmailCount > 3) {
    lines.push(`${p.actionEmailCount} emails need replies — block 20 min to clear the deck?`);
  }
  if (p.risks.length > 0) lines.push(`Heads-up: ${p.risks[0]}`);
  lines.push(p.coachNote);
  return lines.join('\n');
}

export async function generateWeeklyReview(): Promise<WeeklyReview> {
  const { getDatabase } = await import('../db/database');
  const database = await getDatabase();
  const rows = await database.getAllAsync<{ date: string; score: number }>(
    "SELECT date, score FROM daily_streaks WHERE date >= date('now', '-35 day') ORDER BY date ASC",
  );
  const scores = rows.map((r) => r.score);
  const weekAvgs: number[] = [];
  for (let i = scores.length; i > 0; i -= 7) {
    const chunk = scores.slice(Math.max(0, i - 7), i);
    if (chunk.length > 0) {
      weekAvgs.push(Math.round(chunk.reduce((a, b) => a + b, 0) / chunk.length));
    }
  }
  const trendData = weekAvgs.slice(-4);
  const weekScore = trendData.length > 0 ? trendData[trendData.length - 1] : scores.length > 0 ? scores[scores.length - 1] : 0;
  let trend: WeeklyReview['trend'] = 'stable';
  if (trendData.length >= 2) {
    const a = trendData[trendData.length - 2];
    const b = trendData[trendData.length - 1];
    if (b > a + 5) trend = 'improving';
    else if (b < a - 5) trend = 'declining';
  }

  const state = useStore.getState();
  const hydPattern = state.patterns.find((p) => p.description === 'daily_hydration_average');
  const topWin = hydPattern
    ? 'Steady hydration pattern — keep visibility of water at your desk.'
    : 'You showed up this week — consistency counts more than perfection.';

  const pending = state.tasks.filter((t) => t.status === 'pending').length;
  const topChallenge =
    pending > 12 ? `Task backlog (${pending}) — pick one theme to chip away next week.` : 'Protect time for rest between intense days.';

  const correlations: string[] = [];
  const sm = state.patterns.find((p) => p.description === 'sleep_mood_correlation');
  if (sm && (sm.data as { r?: number }).r != null) {
    correlations.push('Better sleep nights line up with better next-day mood in your history.');
  }

  const nextWeekFocus =
    trend === 'declining'
      ? 'Focus on: one daily anchor (sleep, water, or first task before noon).'
      : 'Focus on: morning task completion — compound small wins.';

  let commitmentReview = 'New week — one small experiment is enough.';
  try {
    const cRows = await database.getAllAsync<{ adopted: number }>(
      "SELECT adopted FROM coaching_commitments WHERE date_suggested >= date('now', '-7 day')",
    );
    if (cRows.length > 0) {
      const adopted = cRows.filter((r) => r.adopted === 1).length;
      commitmentReview = `You adopted ${adopted}/${cRows.length} coach suggestions this week.`;
    }
  } catch { /* ignore */ }

  return {
    weekScore,
    trend,
    trendData,
    topWin,
    topChallenge,
    correlations,
    nextWeekFocus,
    commitmentReview,
  };
}

export function formatWeeklyCoachBody(w: WeeklyReview): string {
  const lines = [
    `Week in review (score ~${w.weekScore}/100, ${w.trend})`,
    `Win: ${w.topWin}`,
    `Challenge: ${w.topChallenge}`,
    w.commitmentReview,
    w.nextWeekFocus,
  ];
  if (w.correlations.length) lines.push(w.correlations.join(' '));
  lines.push('What ONE thing will you commit to next week?');
  return lines.join('\n');
}

/** Partner accountability snippet line (caller adds partner name if known). */
export function formatPartnerWeeklyPrompt(score: number): string {
  return `Share your week's progress with your partner? Score: ${score}/100 (optional — accountability helps some people stay on track).`;
}
