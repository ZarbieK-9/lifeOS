// PicoClaw Agent — Watcher (Unified Proactive Intelligence)
// Single source of truth for all proactive behavior.
// Replaces both the old useProactiveAI scheduler and initial watcher.
// Runs on: periodic timer (15min), app foreground, tool execution, goal creation.
// High-priority → push notification. Low-priority → queued in-app.

import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { kv } from '../db/mmkv';
import { eventBus } from './eventBus';
import { assessAll, assessCrossDomain } from './domains/index';
import { detectAnomalies } from './patterns';
import { generateDailyReflection, formatEveningCoach } from './reflection';
import {
  generateMorningPlan,
  persistMorningPlan,
  formatMorningPlanNotificationBody,
  generateWeeklyReview,
  formatWeeklyCoachBody,
  formatPartnerWeeklyPrompt,
} from './coaching';
import type { AgentInsight, GoalDomain } from './types';

type QueuedInsight = { insight: AgentInsight; ruleId: string };

/** Coach rules fire even during "quiet" hours so evening/weekly windows still run. */
const COACH_RULE_IDS = new Set([
  'morning_coach',
  'evening_coach',
  'weekly_coach',
  'partner_weekly_prompt',
]);

function markCoachDedupeForBackground(ruleId: string): void {
  const today = dayjs().format('YYYY-MM-DD');
  if (ruleId === 'morning_coach') kv.set(`bg_coach_morning_sent_${today}`, '1');
  if (ruleId === 'evening_coach') kv.set(`bg_coach_evening_sent_${today}`, '1');
  if (ruleId === 'weekly_coach') kv.set(`bg_coach_weekly_sent_${today}`, '1');
  if (ruleId === 'partner_weekly_prompt') kv.set(`bg_partner_weekly_sent_${today}`, '1');
}

function appendCoachingToBody(insight: AgentInsight): string {
  let body = insight.body;
  if (insight.coachingWhy) body += `\n\n${insight.coachingWhy}`;
  if (insight.coachingTip) body += `\n${insight.coachingTip}`;
  return body;
}

function nextMeetingLine(): string {
  const state = useStore.getState();
  const now = dayjs();
  const upcoming = state.calendarEvents
    .filter((e) => !e.all_day && dayjs(e.start_time).isAfter(now))
    .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
  if (!upcoming) return '';
  return `${upcoming.summary} at ${dayjs(upcoming.start_time).format('h:mm A')}`;
}

// ── Watch Rule ────────────────────────────────────

interface WatchRule {
  id: string;
  name: string;
  check: () => Promise<AgentInsight[]>;
  cooldownMin: number;
}

// ── Cooldown tracker (persisted to MMKV — survives restarts) ─

function canFire(rule: WatchRule): boolean {
  const key = `watcher_cd_${rule.id}`;
  const last = kv.getString(key);
  if (!last) return true;
  return dayjs().diff(dayjs(last), 'minute') >= rule.cooldownMin;
}

function markFired(ruleId: string): void {
  kv.set(`watcher_cd_${ruleId}`, new Date().toISOString());
}

// ── Built-in watch rules ──────────────────────────

const rules: WatchRule[] = [
  {
    id: 'geofence_grocery',
    name: 'Geofence Grocery Reminder',
    cooldownMin: 180,
    check: async () => {
      const s = useStore.getState();
      if (!s.locationContextEnabled || !s.lastKnownLocation) return [];
      const loc = s.lastKnownLocation;
      const near = s.geofencePlaces.find((p) => {
        const dx = (loc.lat - p.lat) * 111_000;
        const dy = (loc.lng - p.lng) * 111_000;
        const d = Math.sqrt(dx * dx + dy * dy);
        return d <= p.radius_m;
      });
      if (!near) return [];
      return [{
        domain: 'productivity' as GoalDomain,
        priority: 'low' as const,
        title: `Near ${near.name}`,
        body: near.reminder_text || `You are near ${near.name}.`,
      }];
    },
  },
  // ── Core assessment rules ─────────────────
  {
    id: 'anomaly_scan',
    name: 'Anomaly Detection',
    cooldownMin: 30,
    check: async () => {
      const anomalies = await detectAnomalies();
      return anomalies.map((a) => ({
        domain: a.domain,
        priority: a.severity === 'high' ? 'high' as const : 'low' as const,
        title: formatAnomalyTitle(a.description),
        body: formatAnomalyBody(a.description, a.data),
      }));
    },
  },
  {
    id: 'domain_assess',
    name: 'Domain Assessment',
    cooldownMin: 45,
    check: async () => assessAll(),
  },
  {
    id: 'cross_domain',
    name: 'Cross-Domain Goal Conflicts',
    cooldownMin: 240,
    check: async () => assessCrossDomain(),
  },

  // ── Goal tracking ─────────────────────────
  {
    id: 'goal_check',
    name: 'Goal Milestones',
    cooldownMin: 120,
    check: async () => {
      const goals = useStore.getState().goals.filter((g) => g.status === 'active');
      const insights: AgentInsight[] = [];
      for (const g of goals) {
        if (!g.targetValue) continue;
        const pct = (g.currentValue / g.targetValue) * 100;
        if (pct >= 100) {
          insights.push({ domain: g.domain, priority: 'high', title: `Goal achieved: ${g.title}`, body: `You've reached your target of ${g.targetValue} ${g.unit ?? ''}!` });
        } else if (pct >= 75 && pct < 100) {
          insights.push({ domain: g.domain, priority: 'low', title: `Almost there: ${g.title}`, body: `${Math.round(pct)}% complete (${g.currentValue}/${g.targetValue} ${g.unit ?? ''}).` });
        }
      }
      return insights;
    },
  },
  {
    id: 'goal_pace',
    name: 'Goal Pace Check',
    cooldownMin: 180,
    check: async () => {
      const state = useStore.getState();
      const now = dayjs();
      const hour = now.hour();
      if (hour < 10 || hour > 20) return []; // only check during active hours
      const insights: AgentInsight[] = [];

      for (const g of state.goals.filter((g) => g.status === 'active' && g.targetValue)) {
        // Daily goals: check pace (e.g., hydration)
        if (g.unit === 'ml' || g.unit === 'tasks') {
          const dayProgress = Math.max(0.1, (hour - 7) / 14); // 7am-9pm window
          const expectedValue = g.targetValue! * dayProgress;
          const deficit = expectedValue - g.currentValue;
          if (deficit > g.targetValue! * 0.25) {
            insights.push({
              domain: g.domain,
              priority: deficit > g.targetValue! * 0.4 ? 'high' : 'low',
              title: `Behind pace: ${g.title}`,
              body: `At ${Math.round(g.currentValue)}/${g.targetValue} ${g.unit}. Expected ~${Math.round(expectedValue)} by now. ${Math.round(deficit)} ${g.unit} to catch up.`,
            });
          }
        }
      }
      return insights;
    },
  },

  {
    id: 'goal_deadline',
    name: 'Goal Deadline Check',
    cooldownMin: 720, // twice a day
    check: async () => {
      const goals = useStore.getState().goals.filter((g) => g.status === 'active' && g.deadline);
      const now = dayjs();
      const insights: AgentInsight[] = [];
      for (const g of goals) {
        const deadline = dayjs(g.deadline);
        if (deadline.isBefore(now)) {
          insights.push({
            domain: g.domain,
            priority: 'high',
            title: `Goal overdue: ${g.title}`,
            body: `Deadline was ${deadline.format('MMM D')}. ${g.targetValue ? `Progress: ${Math.round((g.currentValue / g.targetValue) * 100)}%.` : ''} Update or extend it?`,
          });
        } else if (deadline.diff(now, 'day') <= 3) {
          insights.push({
            domain: g.domain,
            priority: 'high',
            title: `Goal deadline approaching: ${g.title}`,
            body: `${deadline.diff(now, 'day')} day${deadline.diff(now, 'day') !== 1 ? 's' : ''} left. ${g.targetValue ? `${Math.round((g.currentValue / g.targetValue) * 100)}% done.` : ''}`,
          });
        }
      }
      return insights;
    },
  },

  // ── Schedule-based (migrated from useProactiveAI) ─
  {
    id: 'morning_coach',
    name: 'Morning Coach',
    cooldownMin: 720,
    check: async () => {
      const hour = new Date().getHours();
      if (hour < 7 || hour > 10) return [];
      try {
        const plan = await generateMorningPlan();
        persistMorningPlan(plan);
        return [{
          domain: 'productivity' as GoalDomain,
          priority: 'high' as const,
          title: 'Your morning plan is ready',
          body: formatMorningPlanNotificationBody(plan),
        }];
      } catch {
        return [];
      }
    },
  },
  {
    id: 'evening_coach',
    name: 'Evening Coach',
    cooldownMin: 720,
    check: async () => {
      const hour = new Date().getHours();
      if (hour < 20 || hour > 23) return [];
      try {
        const reflection = await generateDailyReflection();
        return [{
          domain: 'productivity' as GoalDomain,
          priority: 'low' as const,
          title: `Evening coach · ${reflection.score}/100`,
          body: formatEveningCoach(reflection),
        }];
      } catch {
        return [];
      }
    },
  },
  {
    id: 'weekly_coach',
    name: 'Weekly Coach Review',
    cooldownMin: 10080,
    check: async () => {
      const hour = new Date().getHours();
      const dow = new Date().getDay();
      if (dow !== 0 || hour < 19 || hour > 21) return [];
      try {
        const review = await generateWeeklyReview();
        return [{
          domain: 'productivity' as GoalDomain,
          priority: 'low' as const,
          title: 'Your week in review',
          body: formatWeeklyCoachBody(review),
        }];
      } catch {
        return [];
      }
    },
  },
  {
    id: 'partner_weekly_prompt',
    name: 'Partner accountability (weekly)',
    cooldownMin: 10080,
    check: async () => {
      const hour = new Date().getHours();
      const dow = new Date().getDay();
      if (dow !== 0 || hour < 19 || hour > 21) return [];
      const score = useStore.getState().dailyScore;
      return [{
        domain: 'social' as GoalDomain,
        priority: 'low' as const,
        title: 'Optional: share progress',
        body: formatPartnerWeeklyPrompt(score),
      }];
    },
  },

  // ── Calendar (migrated from useProactiveAI) ───────
  {
    id: 'calendar_alert',
    name: 'Calendar Alert',
    cooldownMin: 5, // can fire frequently for different events
    check: async () => {
      const state = useStore.getState();
      if (!state.isGoogleConnected || state.calendarEvents.length === 0) return [];
      const now = dayjs();
      const insights: AgentInsight[] = [];

      for (const event of state.calendarEvents) {
        if (event.all_day) continue;
        const start = dayjs(event.start_time);
        const minutesUntil = start.diff(now, 'minute');

        // Alert 15 min before
        if (minutesUntil > 0 && minutesUntil <= 15) {
          // Deduplicate using MMKV key per event
          const eventKey = `watcher_cd_cal_${event.event_id}`;
          if (kv.getString(eventKey)) continue;
          kv.set(eventKey, now.toISOString());

          insights.push({
            domain: 'productivity',
            priority: 'high',
            title: `${event.summary} in ${minutesUntil}min`,
            body: `Starting at ${start.format('h:mm A')}${event.location ? ` at ${event.location}` : ''}`,
          });
          break; // one alert at a time
        }
      }
      return insights;
    },
  },
  {
    id: 'calendar_prep',
    name: 'Calendar Prep',
    cooldownMin: 60,
    check: async () => {
      const state = useStore.getState();
      if (!state.isGoogleConnected || state.calendarEvents.length === 0) return [];
      const now = dayjs();
      const insights: AgentInsight[] = [];

      for (const event of state.calendarEvents) {
        if (event.all_day) continue;
        const start = dayjs(event.start_time);
        const minutesUntil = start.diff(now, 'minute');

        // 30 min before: check for related pending tasks
        if (minutesUntil > 15 && minutesUntil <= 35) {
          const summary = event.summary.toLowerCase();
          const relatedTasks = state.tasks.filter(
            (t) => t.status === 'pending' && (
              t.title.toLowerCase().includes(summary.split(' ')[0]) ||
              summary.includes(t.title.toLowerCase().split(' ')[0])
            ),
          );
          if (relatedTasks.length > 0) {
            insights.push({
              domain: 'productivity',
              priority: 'high',
              title: `Prep for ${event.summary}`,
              body: `In ${minutesUntil}min. ${relatedTasks.length} related task${relatedTasks.length > 1 ? 's' : ''} unfinished: ${relatedTasks.map(t => t.title).join(', ')}`,
            });
            break;
          }
        }
      }
      return insights;
    },
  },
  {
    id: 'calendar_gap',
    name: 'Calendar Free Time',
    cooldownMin: 360, // once per 6h
    check: async () => {
      const state = useStore.getState();
      if (!state.isGoogleConnected) return [];
      const now = dayjs();

      for (const event of state.calendarEvents) {
        if (event.all_day) continue;
        const start = dayjs(event.start_time);
        const minutesUntil = start.diff(now, 'minute');
        if (minutesUntil >= 30 && minutesUntil <= 60) {
          const highTasks = state.tasks.filter((t) => t.status === 'pending' && t.priority === 'high');
          if (highTasks.length > 0) {
            return [{
              domain: 'productivity' as GoalDomain,
              priority: 'low' as const,
              title: `${minutesUntil}min free before ${event.summary}`,
              body: `Good time for a focus session? ${highTasks.length} high-priority task${highTasks.length > 1 ? 's' : ''} waiting.`,
            }];
          }
        }
      }
      return [];
    },
  },

  // ── Email (migrated from useProactiveAI) ──────────
  {
    id: 'inbox_clarity_coach',
    name: 'Inbox clarity (coaching)',
    cooldownMin: 180,
    check: async () => {
      const state = useStore.getState();
      if (!state.isGoogleConnected) return [];
      const hour = new Date().getHours();
      const untriaged = state.emails.filter((e) => e.category === null);
      if (untriaged.length < 6) return [];
      if (hour < 11 || hour > 18) return [];
      return [{
        domain: 'social' as GoalDomain,
        priority: 'low' as const,
        title: 'Inbox clarity',
        body: `${untriaged.length} messages uncategorized — sorting helps you see what you actually need to do (not about unread count).`,
        coachingTip: 'When ready, triage in one short pass; no need to auto-sort everything.',
        suggestedAction: { tool: 'triage_emails', params: {} },
      }];
    },
  },

  // ── Pattern-based proactive nudges ────────────────
  {
    id: 'habit_optimal_time',
    name: 'Habit Optimal Time',
    cooldownMin: 120,
    check: async () => {
      const state = useStore.getState();
      const hour = new Date().getHours();
      const habitPattern = state.patterns.find((p) => p.description === 'habit_log_times');
      if (!habitPattern) return [];

      const hours = (habitPattern.data as any).hours as number[] ?? [];
      if (!hours.includes(hour)) return [];

      // Check if user already logged habits this hour
      const today = dayjs().format('YYYY-MM-DD');
      const recentLogs = state.habitLogs.filter(
        (l) => dayjs(l.logged_at).format('YYYY-MM-DD') === today && dayjs(l.logged_at).hour() === hour,
      );
      if (recentLogs.length > 0) return [];

      const unfinished = state.habits.filter((h) => {
        if (!h.enabled) return false;
        const todayLogs = state.habitLogs.filter((l) => l.habit_id === h.id && dayjs(l.logged_at).format('YYYY-MM-DD') === today);
        const count = todayLogs.reduce((s, l) => s + l.value, 0);
        return count < h.target_per_day;
      });
      if (unfinished.length === 0) return [];

      return [{
        domain: 'health' as GoalDomain,
        priority: 'low' as const,
        title: `${unfinished[0].icon} Time for ${unfinished[0].name}`,
        body: `It's ${hour}:00 — this is your usual time. ${unfinished.length > 1 ? `${unfinished.length - 1} more habit${unfinished.length > 2 ? 's' : ''} left today.` : ''}`,
      }];
    },
  },
  {
    id: 'pattern_nudge',
    name: 'Pattern-Based Hydration Nudge',
    cooldownMin: 90,
    check: async () => {
      const state = useStore.getState();
      const hour = new Date().getHours();
      const hydPattern = state.patterns.find((p) => p.description === 'hydration_time_clusters');
      if (!hydPattern) return [];

      const hours = (hydPattern.data as any).hours as number[] ?? [];
      if (!hours.includes(hour)) return [];

      const hourStart = dayjs().startOf('hour').toISOString();
      const recentLogs = state.hydrationLogs.filter((l) => l.timestamp >= hourStart);
      if (recentLogs.length > 0) return [];

      const goal = state.hydrationGoalMl || 2500;
      const pct = Math.round((state.hydrationTodayMl / goal) * 100);
      const meetingHint = nextMeetingLine();

      kv.set('hydration_nudge_pending_at', new Date().toISOString());

      return [{
        domain: 'health' as GoalDomain,
        priority: 'low' as const,
        title: 'Hydration check-in',
        body: `You usually drink around now — ${state.hydrationTodayMl}ml of ${goal}ml so far (${pct}%).`,
        coachingWhy: 'Staying hydrated supports steadier focus through the afternoon.',
        coachingTip: meetingHint
          ? `A quick glass now stacks well before ${meetingHint}.`
          : 'Keep a bottle visible — it beats relying on memory when you are busy.',
        suggestedAction: { tool: 'log_hydration', params: { amount_ml: 250 } },
      }];
    },
  },
  {
    id: 'hydration_coach_escalate',
    name: 'Hydration coach follow-up',
    cooldownMin: 15,
    check: async () => {
      const pending = kv.getString('hydration_nudge_pending_at');
      if (!pending) return [];
      const elapsedMin = dayjs().diff(dayjs(pending), 'minute');
      if (elapsedMin < 120) return [];

      const state = useStore.getState();
      const loggedSince = state.hydrationLogs.some((l) => l.timestamp >= pending);
      if (loggedSince) {
        kv.delete('hydration_nudge_pending_at');
        return [];
      }

      const goal = state.hydrationGoalMl || 2500;
      const deficit = Math.max(0, goal - state.hydrationTodayMl);
      const next = nextMeetingLine();
      kv.delete('hydration_nudge_pending_at');

      return [{
        domain: 'health' as GoalDomain,
        priority: 'low' as const,
        title: 'Still thinking about water?',
        body: `You have not logged water since your usual hydration window. ${deficit > 0 ? `${deficit}ml left to hit today's target.` : ''}`.trim(),
        coachingWhy: 'Small fluid top-ups before dense work blocks help more than chugging late.',
        coachingTip: next ? `A glass now keeps energy steadier ahead of ${next}.` : 'One glass now is enough to reset the streak.',
        suggestedAction: { tool: 'log_hydration', params: { amount_ml: 250 } },
      }];
    },
  },
  {
    id: 'energy_aware',
    name: 'Energy-Aware Task Suggestions',
    cooldownMin: 240,
    check: async () => {
      const state = useStore.getState();
      const now = dayjs();

      // Check today's most recent mood/energy
      const todayMood = state.moodLogs.find((m) => dayjs(m.logged_at).isSame(now, 'day'));
      if (!todayMood || todayMood.energy > 2) return []; // only nudge when energy is low

      const highTasks = state.tasks.filter((t) => t.status === 'pending' && t.priority === 'high');
      const lowTasks = state.tasks.filter((t) => t.status === 'pending' && t.priority === 'low');

      if (highTasks.length === 0) return [];

      return [{
        domain: 'productivity' as GoalDomain,
        priority: 'low' as const,
        title: 'Low energy day',
        body: `Energy logged at ${todayMood.energy}/5. Consider starting with easier tasks${lowTasks.length > 0 ? ` (${lowTasks.length} low-priority available)` : ''} and saving the ${highTasks.length} big one${highTasks.length > 1 ? 's' : ''} for later.`,
        coachingWhy: 'Matching task difficulty to energy reduces guilt and keeps you moving.',
        coachingTip: 'If something has been pending 3 days, one tiny next step still counts.',
      }];
    },
  },
  // ── Coaching commitment follow-up ─────────────────
  {
    id: 'commitment_followup',
    name: 'Coaching Commitment Follow-up',
    cooldownMin: 720,
    check: async () => {
      const { getDatabase } = await import('../db/database');
      const db = await getDatabase();
      const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
      const commit = await db.getFirstAsync<{ id: string; suggestion: string; adopted: number }>(
        "SELECT id, suggestion, adopted FROM coaching_commitments WHERE date_suggested = ? AND adopted = 0 ORDER BY created_at DESC LIMIT 1",
        [yesterday],
      );
      if (!commit) return [];
      return [{
        domain: 'health' as GoalDomain,
        priority: 'low' as const,
        title: 'How did it go?',
        body: `Yesterday I suggested: "${commit.suggestion.slice(0, 100)}". Did you try it?`,
        coachingWhy: 'Reflecting on attempts helps me give better suggestions.',
        suggestedAction: { tool: 'update_commitment', params: { id: commit.id, adopted: 1, outcome: 'helped' } },
      }];
    },
  },
];

// ── Anomaly formatters ────────────────────────────

function formatAnomalyTitle(desc: string): string {
  switch (desc) {
    case 'hydration_behind_pace': return 'Behind on water';
    case 'past_usual_bedtime': return 'Past your bedtime';
    case 'overdue_tasks': return 'Overdue tasks';
    case 'unusual_spending': return 'Unusual spending';
    default: return desc.replace(/_/g, ' ');
  }
}

function formatAnomalyBody(desc: string, data: Record<string, unknown>): string {
  switch (desc) {
    case 'hydration_behind_pace':
      return `${data.todayMl}ml so far, should be ~${data.expectedMl}ml. Drink ${data.deficitMl}ml to catch up.`;
    case 'past_usual_bedtime':
      return `It's ${data.currentHour}:00 — your usual bedtime is around ${Math.floor(data.usualBedtime as number)}:00. Good rest = good tomorrow.`;
    case 'overdue_tasks': {
      const titles = (data.titles as string[]) ?? [];
      return `${data.count} task${(data.count as number) > 1 ? 's' : ''} overdue${titles.length > 0 ? ': ' + titles.join(', ') : ''}.`;
    }
    case 'unusual_spending':
      return `$${(data.todaySpend as number).toFixed(2)} today — ${data.ratio}x your daily average.`;
    default:
      return JSON.stringify(data);
  }
}

// ── Main evaluation loop ──────────────────────────

let notifyCallback: ((title: string, body: string, priority: 'high' | 'low') => void) | null = null;

export function setNotifyCallback(cb: (title: string, body: string, priority: 'high' | 'low') => void): void {
  notifyCallback = cb;
}

export async function evaluate(): Promise<AgentInsight[]> {
  const tag = '[Watcher]';
  console.time(`${tag} evaluate`);

  const state = useStore.getState();
  const queued: QueuedInsight[] = [];

  const hour = new Date().getHours();
  const inQuiet =
    hour >= state.proactiveQuietAfterHour || hour < state.proactiveQuietBeforeHour;

  const serverCoach =
    kv.getString('server_coach_enabled') === '1' && state.isBackendConfigured;

  for (const rule of rules) {
    if (serverCoach && COACH_RULE_IDS.has(rule.id)) continue;
    if (inQuiet && !COACH_RULE_IDS.has(rule.id)) continue;
    if (!canFire(rule)) continue;

    try {
      const insights = await rule.check();
      if (insights.length > 0) {
        markFired(rule.id);
        for (const insight of insights) queued.push({ insight, ruleId: rule.id });
      }
    } catch (e) {
      console.warn(`${tag} rule ${rule.id} error:`, e);
    }
  }

  // Coalesce overlapping nudges to reduce notification fatigue.
  const deduped = new Map<string, QueuedInsight>();
  for (const item of queued) {
    const key = [
      item.insight.domain,
      item.insight.suggestedAction?.tool ?? '',
      item.insight.title.toLowerCase().replace(/\s+/g, ' ').trim(),
    ].join('|');
    const current = deduped.get(key);
    if (!current) {
      deduped.set(key, item);
      continue;
    }
    if (current.insight.priority === 'low' && item.insight.priority === 'high') {
      deduped.set(key, item);
    }
  }
  const finalQueue = [...deduped.values()];

  // Dispatch insights
  for (const { insight, ruleId } of finalQueue) {
    if (COACH_RULE_IDS.has(ruleId)) markCoachDedupeForBackground(ruleId);
    const bodyOut = appendCoachingToBody(insight);
    const coachPush =
      ruleId === 'evening_coach' || ruleId === 'weekly_coach' || ruleId === 'partner_weekly_prompt';
    if (notifyCallback && (insight.priority === 'high' || coachPush)) {
      notifyCallback(insight.title, bodyOut, insight.priority === 'high' ? 'high' : 'low');
    }
    await state.addWatcherNotification({
      domain: insight.domain,
      title: insight.title,
      body: bodyOut,
      priority: insight.priority,
      ruleId,
    });

    eventBus.emit({
      type: 'notification',
      priority: insight.priority,
      title: insight.title,
      body: bodyOut,
      domain: insight.domain,
    });
  }

  console.timeEnd(`${tag} evaluate`);
  if (finalQueue.length > 0) console.log(`${tag} ${finalQueue.length} insight(s) dispatched`);
  useStore.getState().logAgentAction({
    agent: 'watcher',
    actionType: 'monitor',
    input: null,
    output: JSON.stringify({
      totalQueued: queued.length,
      dispatched: finalQueue.length,
      highPriority: finalQueue.filter((q) => q.insight.priority === 'high').length,
      rules: [...new Set(finalQueue.map((q) => q.ruleId))],
    }),
    goalId: null,
    planId: null,
    success: true,
  }).catch(() => {});
  return finalQueue.map((q) => q.insight);
}

// ── Engagement tracking ───────────────────────────

async function trackEngagement(toolName: string): Promise<void> {
  void toolName;
  try {
    const { useStore } = await import('../store/useStore');
    await useStore.getState().markRecentWatcherActed(5);
  } catch { /* best-effort */ }
}

// ── Initialize ────────────────────────────────────

const PERIODIC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export function initWatcher(): () => void {
  const unsubs: (() => void)[] = [];

  // Periodic evaluation — the heartbeat of proactive intelligence
  const intervalId = setInterval(() => {
    evaluate().catch((e) => console.warn('[Watcher] periodic eval error:', e));
  }, PERIODIC_INTERVAL_MS);
  unsubs.push(() => clearInterval(intervalId));

  // Evaluate on app foreground
  unsubs.push(eventBus.on('app_lifecycle', async (event) => {
    if (event.action === 'foreground') {
      await evaluate();
    }
  }));

  // Evaluate after tool executions (debounced) + track engagement
  let toolDebounce: ReturnType<typeof setTimeout> | null = null;
  unsubs.push(eventBus.on('tool_result', (event) => {
    if (event.tool === 'log_hydration' && event.result.success) {
      kv.delete('hydration_nudge_pending_at');
    }
    trackEngagement(event.tool).catch(() => {});
    if (toolDebounce) clearTimeout(toolDebounce);
    toolDebounce = setTimeout(() => evaluate(), 5000);
  }));

  // Evaluate on goal creation
  unsubs.push(eventBus.on('goal_created', async () => {
    await evaluate();
  }));

  return () => {
    for (const unsub of unsubs) unsub();
    if (toolDebounce) clearTimeout(toolDebounce);
  };
}
