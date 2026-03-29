// PicoClaw Agent — Pattern Learning Engine
// Deterministic statistical analysis on SQLite data.
// Learns time habits, correlations, preferences, and detects anomalies.
// No LLM needed — runs fast, battery-friendly.

import dayjs from 'dayjs';
import { getDatabase } from '../db/database';
import { useStore } from '../store/useStore';
import type { GoalDomain, PatternType } from './types';

// ── Types ─────────────────────────────────────────

interface PatternResult {
  domain: GoalDomain;
  patternType: PatternType;
  description: string;
  data: Record<string, unknown>;
  confidence: number;
  sampleCount: number;
}

// ── Time clustering ───────────────────────────────

/** Extract hour clusters from timestamps (e.g. "user drinks water around 9am, 12pm, 3pm") */
function clusterHours(timestamps: string[]): number[] {
  if (timestamps.length < 3) return [];
  const hours = timestamps.map((t) => dayjs(t).hour());
  // Count frequency per hour
  const freq = new Map<number, number>();
  for (const h of hours) freq.set(h, (freq.get(h) ?? 0) + 1);
  // Return hours that appear in >20% of entries
  const threshold = timestamps.length * 0.2;
  return [...freq.entries()]
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => a[0] - b[0])
    .map(([hour]) => hour);
}

/** Compute average value per hour of day */
function hourlyAverage(entries: { hour: number; value: number }[]): Map<number, number> {
  const sums = new Map<number, { total: number; count: number }>();
  for (const e of entries) {
    const cur = sums.get(e.hour) ?? { total: 0, count: 0 };
    cur.total += e.value;
    cur.count += 1;
    sums.set(e.hour, cur);
  }
  const avgs = new Map<number, number>();
  for (const [hour, { total, count }] of sums) avgs.set(hour, total / count);
  return avgs;
}

// ── Pattern analyzers ─────────────────────────────

async function analyzeHydrationPatterns(): Promise<PatternResult[]> {
  const db = await getDatabase();
  const results: PatternResult[] = [];

  // Time habit: when does user typically drink water?
  const logs = await db.getAllAsync<{ timestamp: string; amount_ml: number }>(
    "SELECT timestamp, amount_ml FROM hydration_logs WHERE timestamp > datetime('now', '-30 days') ORDER BY timestamp",
  );
  if (logs.length >= 5) {
    const clusters = clusterHours(logs.map((l) => l.timestamp));
    if (clusters.length >= 2) {
      results.push({
        domain: 'health',
        patternType: 'time_habit',
        description: 'hydration_time_clusters',
        data: { hours: clusters, avgMl: Math.round(logs.reduce((s, l) => s + l.amount_ml, 0) / logs.length) },
        confidence: Math.min(0.9, 0.3 + logs.length * 0.02),
        sampleCount: logs.length,
      });
    }

    // Average daily intake
    const dailyTotals = new Map<string, number>();
    for (const l of logs) {
      const day = dayjs(l.timestamp).format('YYYY-MM-DD');
      dailyTotals.set(day, (dailyTotals.get(day) ?? 0) + l.amount_ml);
    }
    const days = [...dailyTotals.values()];
    if (days.length >= 3) {
      const avg = Math.round(days.reduce((s, v) => s + v, 0) / days.length);
      results.push({
        domain: 'health',
        patternType: 'preference',
        description: 'daily_hydration_average',
        data: { avgMl: avg, minMl: Math.min(...days), maxMl: Math.max(...days) },
        confidence: Math.min(0.9, 0.4 + days.length * 0.03),
        sampleCount: days.length,
      });
    }
  }

  return results;
}

async function analyzeSleepPatterns(): Promise<PatternResult[]> {
  const db = await getDatabase();
  const results: PatternResult[] = [];

  const sessions = await db.getAllAsync<{ sleep_start: string; sleep_end: string; duration_minutes: number }>(
    "SELECT sleep_start, sleep_end, duration_minutes FROM sleep_sessions WHERE sleep_start > datetime('now', '-30 days') AND sleep_end IS NOT NULL ORDER BY sleep_start",
  );
  if (sessions.length >= 3) {
    const bedtimeHours = sessions.map((s) => dayjs(s.sleep_start).hour() + dayjs(s.sleep_start).minute() / 60);
    const wakeHours = sessions.map((s) => dayjs(s.sleep_end).hour() + dayjs(s.sleep_end).minute() / 60);
    const durations = sessions.map((s) => s.duration_minutes);

    const avgBedtime = bedtimeHours.reduce((s, v) => s + v, 0) / bedtimeHours.length;
    const avgWake = wakeHours.reduce((s, v) => s + v, 0) / wakeHours.length;
    const avgDuration = durations.reduce((s, v) => s + v, 0) / durations.length;

    results.push({
      domain: 'health',
      patternType: 'time_habit',
      description: 'sleep_schedule',
      data: {
        avgBedtimeHour: Math.round(avgBedtime * 10) / 10,
        avgWakeHour: Math.round(avgWake * 10) / 10,
        avgDurationMin: Math.round(avgDuration),
      },
      confidence: Math.min(0.9, 0.3 + sessions.length * 0.05),
      sampleCount: sessions.length,
    });
  }

  return results;
}

async function analyzeMoodPatterns(): Promise<PatternResult[]> {
  const db = await getDatabase();
  const results: PatternResult[] = [];

  // Correlation: mood vs sleep
  const moodWithSleep = await db.getAllAsync<{ mood: number; energy: number; duration_minutes: number }>(
    `SELECT m.mood, m.energy, s.duration_minutes
     FROM mood_logs m
     JOIN sleep_sessions s ON date(m.logged_at) = date(s.sleep_end)
     WHERE m.logged_at > datetime('now', '-30 days') AND s.sleep_end IS NOT NULL`,
  );
  if (moodWithSleep.length >= 5) {
    const goodSleep = moodWithSleep.filter((r) => r.duration_minutes >= 420); // 7+ hours
    const poorSleep = moodWithSleep.filter((r) => r.duration_minutes < 360); // <6 hours
    if (goodSleep.length >= 2 && poorSleep.length >= 2) {
      const goodAvgMood = goodSleep.reduce((s, r) => s + r.mood, 0) / goodSleep.length;
      const poorAvgMood = poorSleep.reduce((s, r) => s + r.mood, 0) / poorSleep.length;
      if (goodAvgMood > poorAvgMood + 0.3) {
        results.push({
          domain: 'health',
          patternType: 'correlation',
          description: 'sleep_mood_correlation',
          data: { goodSleepAvgMood: Math.round(goodAvgMood * 10) / 10, poorSleepAvgMood: Math.round(poorAvgMood * 10) / 10 },
          confidence: Math.min(0.85, 0.4 + moodWithSleep.length * 0.03),
          sampleCount: moodWithSleep.length,
        });
      }
    }
  }

  // Time habit: when user typically logs mood
  const moodTimes = await db.getAllAsync<{ logged_at: string }>(
    "SELECT logged_at FROM mood_logs WHERE logged_at > datetime('now', '-30 days')",
  );
  if (moodTimes.length >= 3) {
    const clusters = clusterHours(moodTimes.map((r) => r.logged_at));
    if (clusters.length >= 1) {
      results.push({
        domain: 'health',
        patternType: 'time_habit',
        description: 'mood_log_times',
        data: { hours: clusters },
        confidence: Math.min(0.8, 0.3 + moodTimes.length * 0.04),
        sampleCount: moodTimes.length,
      });
    }
  }

  return results;
}

async function analyzeTaskPatterns(): Promise<PatternResult[]> {
  const db = await getDatabase();
  const results: PatternResult[] = [];

  // Preference: what priority does user typically set?
  const tasks = await db.getAllAsync<{ priority: string; created_at: string }>(
    "SELECT priority, created_at FROM tasks WHERE created_at > datetime('now', '-30 days')",
  );
  if (tasks.length >= 5) {
    const priorityCounts = { low: 0, medium: 0, high: 0 };
    for (const t of tasks) {
      if (t.priority in priorityCounts) priorityCounts[t.priority as keyof typeof priorityCounts]++;
    }
    const dominant = (Object.entries(priorityCounts) as [string, number][]).sort((a, b) => b[1] - a[1])[0];
    if (dominant[1] > tasks.length * 0.5) {
      results.push({
        domain: 'productivity',
        patternType: 'preference',
        description: 'task_priority_preference',
        data: { dominant: dominant[0], counts: priorityCounts },
        confidence: Math.min(0.85, dominant[1] / tasks.length),
        sampleCount: tasks.length,
      });
    }
  }

  // Completion rate
  const completionStats = await db.getFirstAsync<{ total: number; completed: number }>(
    "SELECT COUNT(*) as total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed FROM tasks WHERE created_at > datetime('now', '-30 days')",
  );
  if (completionStats && completionStats.total >= 5) {
    const rate = completionStats.completed / completionStats.total;
    results.push({
      domain: 'productivity',
      patternType: 'preference',
      description: 'task_completion_rate',
      data: { rate: Math.round(rate * 100) / 100, total: completionStats.total, completed: completionStats.completed },
      confidence: Math.min(0.9, 0.4 + completionStats.total * 0.02),
      sampleCount: completionStats.total,
    });
  }

  return results;
}

async function analyzeSpendingPatterns(): Promise<PatternResult[]> {
  const db = await getDatabase();
  const results: PatternResult[] = [];

  const expenses = await db.getAllAsync<{ amount: number; category: string; date: string }>(
    "SELECT amount, category, date FROM expenses WHERE date > date('now', '-30 days') ORDER BY date",
  );
  if (expenses.length >= 3) {
    // Daily average
    const dailyTotals = new Map<string, number>();
    for (const e of expenses) {
      dailyTotals.set(e.date, (dailyTotals.get(e.date) ?? 0) + e.amount);
    }
    const days = [...dailyTotals.values()];
    const avgDaily = days.reduce((s, v) => s + v, 0) / days.length;

    // Category breakdown
    const catTotals = new Map<string, number>();
    for (const e of expenses) catTotals.set(e.category, (catTotals.get(e.category) ?? 0) + e.amount);
    const topCategory = [...catTotals.entries()].sort((a, b) => b[1] - a[1])[0];

    results.push({
      domain: 'finance',
      patternType: 'preference',
      description: 'spending_habits',
      data: {
        avgDaily: Math.round(avgDaily * 100) / 100,
        topCategory: topCategory?.[0] ?? 'other',
        topCategoryTotal: topCategory?.[1] ?? 0,
        categories: Object.fromEntries(catTotals),
      },
      confidence: Math.min(0.85, 0.3 + expenses.length * 0.03),
      sampleCount: expenses.length,
    });
  }

  return results;
}

async function analyzeHabitPatterns(): Promise<PatternResult[]> {
  const db = await getDatabase();
  const results: PatternResult[] = [];

  const habitLogs = await db.getAllAsync<{ habit_id: string; logged_at: string }>(
    "SELECT habit_id, logged_at FROM habit_logs WHERE logged_at > datetime('now', '-30 days')",
  );
  if (habitLogs.length >= 5) {
    const clusters = clusterHours(habitLogs.map((l) => l.logged_at));
    if (clusters.length >= 1) {
      results.push({
        domain: 'health',
        patternType: 'time_habit',
        description: 'habit_log_times',
        data: { hours: clusters },
        confidence: Math.min(0.8, 0.3 + habitLogs.length * 0.03),
        sampleCount: habitLogs.length,
      });
    }
  }

  return results;
}

// ── Anomaly detection ─────────────────────────────

export interface Anomaly {
  domain: GoalDomain;
  description: string;
  severity: 'low' | 'medium' | 'high';
  data: Record<string, unknown>;
}

/** Detect anomalies based on learned patterns vs current state. */
export async function detectAnomalies(): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = [];
  const patterns = useStore.getState().patterns;
  const now = dayjs();
  const currentHour = now.hour();

  // Hydration pacing anomaly
  const hydrationTimePattern = patterns.find((p) => p.description === 'hydration_time_clusters');
  const hydrationAvgPattern = patterns.find((p) => p.description === 'daily_hydration_average');
  if (hydrationAvgPattern && hydrationTimePattern) {
    const avgDaily = (hydrationAvgPattern.data as any).avgMl ?? 2500;
    const todayMl = useStore.getState().hydrationTodayMl;
    const hoursElapsed = currentHour - 7; // assume day starts at 7am
    const hoursInDay = 14; // 7am - 9pm
    if (hoursElapsed > 2) {
      const expectedPace = (avgDaily * hoursElapsed) / hoursInDay;
      const deficit = expectedPace - todayMl;
      if (deficit > avgDaily * 0.25) {
        anomalies.push({
          domain: 'health',
          description: 'hydration_behind_pace',
          severity: deficit > avgDaily * 0.4 ? 'high' : 'medium',
          data: { todayMl, expectedMl: Math.round(expectedPace), deficitMl: Math.round(deficit) },
        });
      }
    }
  }

  // Sleep anomaly — past usual bedtime
  const sleepPattern = patterns.find((p) => p.description === 'sleep_schedule');
  if (sleepPattern) {
    const avgBedtime = (sleepPattern.data as any).avgBedtimeHour ?? 23;
    const sleepState = useStore.getState().sleep;
    if (!sleepState.isAsleep && currentHour >= avgBedtime + 0.5 && currentHour < avgBedtime + 3) {
      anomalies.push({
        domain: 'health',
        description: 'past_usual_bedtime',
        severity: currentHour >= avgBedtime + 1 ? 'medium' : 'low',
        data: { usualBedtime: avgBedtime, currentHour },
      });
    }
  }

  // Task overdue anomaly
  const tasks = useStore.getState().tasks;
  const overdueTasks = tasks.filter(
    (t) => t.status === 'pending' && t.due_date && dayjs(t.due_date).isBefore(now),
  );
  if (overdueTasks.length > 0) {
    anomalies.push({
      domain: 'productivity',
      description: 'overdue_tasks',
      severity: overdueTasks.length >= 3 ? 'high' : 'medium',
      data: { count: overdueTasks.length, titles: overdueTasks.slice(0, 3).map((t) => t.title) },
    });
  }

  // Spending anomaly — daily spend > 2x average
  const spendingPattern = patterns.find((p) => p.description === 'spending_habits');
  if (spendingPattern) {
    const avgDaily = (spendingPattern.data as any).avgDaily ?? 0;
    const todaySpend = useStore.getState().todaySpend;
    if (avgDaily > 0 && todaySpend > avgDaily * 2) {
      anomalies.push({
        domain: 'finance',
        description: 'unusual_spending',
        severity: todaySpend > avgDaily * 3 ? 'high' : 'medium',
        data: { todaySpend, avgDaily, ratio: Math.round(todaySpend / avgDaily * 10) / 10 },
      });
    }
  }

  return anomalies;
}

// ── Main runner ───────────────────────────────────

/** Run all pattern analyzers and persist results. Call on app foreground / after tool executions. */
export async function analyzePatterns(): Promise<PatternResult[]> {
  const tag = '[Patterns]';
  console.time(`${tag} analyze`);

  const [hydration, sleep, mood, tasks, spending, habits] = await Promise.all([
    analyzeHydrationPatterns().catch(() => []),
    analyzeSleepPatterns().catch(() => []),
    analyzeMoodPatterns().catch(() => []),
    analyzeTaskPatterns().catch(() => []),
    analyzeSpendingPatterns().catch(() => []),
    analyzeHabitPatterns().catch(() => []),
  ]);

  const allPatterns = [...hydration, ...sleep, ...mood, ...tasks, ...spending, ...habits];

  // Persist all patterns
  const store = useStore.getState();
  for (const p of allPatterns) {
    await store.upsertPattern({
      domain: p.domain,
      patternType: p.patternType,
      description: p.description,
      data: p.data,
      confidence: p.confidence,
      sampleCount: p.sampleCount,
      lastUpdated: new Date().toISOString(),
    });
  }

  console.timeEnd(`${tag} analyze`);
  console.log(`${tag} found ${allPatterns.length} patterns`);
  return allPatterns;
}

// ── Incremental per-domain updates ────────────────

/** Map tool names to the domain analyzers that should re-run when the tool fires. */
const TOOL_TO_ANALYZERS: Record<string, () => Promise<PatternResult[]>> = {
  log_hydration: analyzeHydrationPatterns,
  set_hydration_reminder: analyzeHydrationPatterns,
  log_sleep: analyzeSleepPatterns,
  log_mood: analyzeMoodPatterns,
  add_task: analyzeTaskPatterns,
  complete_task: analyzeTaskPatterns,
  delete_task: analyzeTaskPatterns,
  log_expense: analyzeSpendingPatterns,
  set_budget: analyzeSpendingPatterns,
  log_habit: analyzeHabitPatterns,
  add_habit: analyzeHabitPatterns,
};

/**
 * Lightweight incremental pattern update — only re-analyzes the domain
 * affected by a specific tool execution. Much faster than full analyzePatterns().
 * Call via event bus after tool_result events.
 */
export async function updatePatternsForTool(toolName: string): Promise<void> {
  const analyzer = TOOL_TO_ANALYZERS[toolName];
  if (!analyzer) return;

  try {
    const results = await analyzer();
    const store = useStore.getState();
    for (const p of results) {
      await store.upsertPattern({
        domain: p.domain,
        patternType: p.patternType,
        description: p.description,
        data: p.data,
        confidence: p.confidence,
        sampleCount: p.sampleCount,
        lastUpdated: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.warn('[Patterns] incremental update error:', e);
  }
}

/** Get a human-readable summary of patterns for LLM context. */
export function getPatternSummary(): string {
  const patterns = useStore.getState().patterns;
  if (patterns.length === 0) return '';

  const lines: string[] = ['LEARNED PATTERNS:'];
  for (const p of patterns) {
    if (p.confidence < 0.4) continue; // skip low-confidence

    switch (p.description) {
      case 'hydration_time_clusters':
        lines.push(`- User typically drinks water around: ${(p.data as any).hours?.map((h: number) => `${h}:00`).join(', ')}`);
        break;
      case 'daily_hydration_average':
        lines.push(`- Average daily water intake: ${(p.data as any).avgMl}ml`);
        break;
      case 'sleep_schedule':
        lines.push(`- Usual bedtime: ~${Math.floor((p.data as any).avgBedtimeHour)}:${String(Math.round(((p.data as any).avgBedtimeHour % 1) * 60)).padStart(2, '0')}, wake: ~${Math.floor((p.data as any).avgWakeHour)}:${String(Math.round(((p.data as any).avgWakeHour % 1) * 60)).padStart(2, '0')}, avg sleep: ${Math.round((p.data as any).avgDurationMin / 60 * 10) / 10}h`);
        break;
      case 'sleep_mood_correlation':
        lines.push(`- Better sleep → better mood (good sleep avg mood: ${(p.data as any).goodSleepAvgMood}, poor sleep: ${(p.data as any).poorSleepAvgMood})`);
        break;
      case 'task_completion_rate':
        lines.push(`- Task completion rate: ${Math.round((p.data as any).rate * 100)}%`);
        break;
      case 'spending_habits':
        lines.push(`- Average daily spending: $${(p.data as any).avgDaily}, top category: ${(p.data as any).topCategory}`);
        break;
      default:
        lines.push(`- ${p.description}: ${JSON.stringify(p.data)}`);
    }
  }
  return lines.join('\n');
}
