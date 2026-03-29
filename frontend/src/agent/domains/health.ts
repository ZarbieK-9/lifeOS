// PicoClaw — Health Domain Agent (coaching signals: sleep, mood, hydration, habits)

import dayjs from 'dayjs';
import type { AgentEvent } from '../eventBus';
import { eventBus } from '../eventBus';
import type { AgentInsight, PlanStep, ToolResult } from '../types';
import type { DomainAgent } from './index';
import { toolRegistry } from '../tools';
import { useStore } from '../../store/useStore';

export const healthAgent: DomainAgent = {
  name: 'health',
  domain: 'health',
  ownedTools: [
    'log_hydration', 'query_hydration', 'set_hydration_reminder', 'disable_hydration_reminder',
    'log_sleep', 'query_sleep',
    'log_mood', 'query_mood',
    'add_habit', 'log_habit',
  ],

  async assess(): Promise<AgentInsight[]> {
    const insights: AgentInsight[] = [];
    const state = useStore.getState();
    const now = dayjs();
    const hour = now.hour();

    // ── Hydration pacing (coached, not nagging) ───
    const goal = state.hydrationGoalMl || 2500;
    const todayMl = state.hydrationTodayMl;
    const dayProgress = Math.max(0, (hour - 7) / 14);

    if (hour >= 9 && dayProgress > 0) {
      const expected = goal * dayProgress;
      const deficit = expected - todayMl;
      const pct = todayMl / goal;

      if (deficit > goal * 0.3) {
        const catchUpMl = Math.round(deficit);
        insights.push({
          domain: 'health',
          priority: deficit > goal * 0.45 ? 'high' : 'low',
          title: 'Hydration check-in',
          body: `You're at ${todayMl}ml — around ${Math.round(expected)}ml would match your usual pace. A glass now supports focus later.`,
          coachingWhy: 'Afternoon energy dips often track with fluid intake on your busier days.',
          coachingTip: 'Pair water with something you already do (before email, after calls).',
          suggestedAction: { tool: 'log_hydration', params: { amount_ml: Math.min(500, catchUpMl) } },
        });
      } else if (pct >= 1) {
        insights.push({
          domain: 'health',
          priority: 'low',
          title: 'Hydration on track',
          body: `${todayMl}ml — you hit your ${goal}ml target. Nice steady habit.`,
        });
      }
    }

    // ── Morning sleep check-in (7–9am) — not bedtime nag ──
    const lastSleep = state.sleepSessions[0];
    const sleepLoggedToday = lastSleep && dayjs(lastSleep.sleep_end).isSame(now, 'day');
    if (hour >= 7 && hour < 9 && !sleepLoggedToday && !state.sleep.isAsleep) {
      insights.push({
        domain: 'health',
        priority: 'low',
        title: 'How\'d you sleep?',
        body: 'Good rest fuels a good day. Reply with how many hours you got, or log sleep when you can.',
        coachingWhy: 'Sleep quality feeds your mood and focus — your coach uses it for today\'s energy forecast.',
        coachingTip: 'Even a rough estimate helps.',
        suggestedAction: { tool: 'query_sleep', params: {} },
      });
    }

    // ── Evening bedtime hint (keep light) ─────────
    const sleepPattern = state.patterns.find((p) => p.description === 'sleep_schedule');
    if (sleepPattern && !state.sleep.isAsleep && hour >= 21) {
      const avgBedtime = (sleepPattern.data as { avgBedtimeHour?: number }).avgBedtimeHour ?? 23;
      if (hour >= avgBedtime + 0.5 && hour < avgBedtime + 3) {
        insights.push({
          domain: 'health',
          priority: hour >= avgBedtime + 1 ? 'high' : 'low',
          title: 'Wind-down window',
          body: `Near your usual bedtime (~${Math.floor(avgBedtime)}:${String(Math.round((avgBedtime % 1) * 60)).padStart(2, '0')}). Protected sleep = better tomorrow.`,
          coachingWhy: 'Consistent bedtimes improve next-day mood in your patterns.',
          suggestedAction: { tool: 'log_sleep', params: { action: 'start' } },
        });
      }
    }

    // ── Morning energy check (planner context) ───
    const todayMood = state.moodLogs.find((m) => dayjs(m.logged_at).isSame(now, 'day'));
    if (!todayMood && hour >= 7 && hour <= 11) {
      insights.push({
        domain: 'health',
        priority: 'low',
        title: 'How\'s your energy?',
        body: 'Quick 1–5 tap helps me plan your day and match tasks to how you feel.',
        coachingWhy: 'Feeds energy-aware scheduling when tasks pile up.',
        coachingTip: 'Honest ratings beat hero mode — we adjust suggestions.',
      });
    } else if (!todayMood && hour >= 12 && hour <= 20) {
      insights.push({
        domain: 'health',
        priority: 'low',
        title: 'Energy check-in',
        body: 'No mood log yet — a short check-in keeps patterns useful.',
        coachingWhy: 'Evening reflection is richer when we know how the day felt.',
      });
    }

    // ── Evening energy reflection prompt ──────────
    if (todayMood && todayMood.energy <= 2 && hour >= 18) {
      insights.push({
        domain: 'health',
        priority: 'low',
        title: 'Low energy day',
        body: `You rated energy ${todayMood.energy}/5. What drained you? A note helps next week's coaching.`,
        coachingWhy: 'Linking drains to calendar or sleep improves weekly analysis.',
      });
    }

    // ── Habit streak (one reminder) ───────────────
    const habits = state.habits.filter((h) => h.enabled);
    const today = now.format('YYYY-MM-DD');
    for (const habit of habits) {
      const todayLogs = state.habitLogs.filter(
        (l) => l.habit_id === habit.id && dayjs(l.logged_at).format('YYYY-MM-DD') === today,
      );
      const todayCount = todayLogs.reduce((s, l) => s + l.value, 0);
      if (todayCount < habit.target_per_day && hour >= 18) {
        insights.push({
          domain: 'health',
          priority: 'low',
          title: `${habit.icon} ${habit.name}`,
          body: `${todayCount}/${habit.target_per_day} today — small finish still counts.`,
          coachingTip: 'Stack it with an existing routine so it sticks.',
          suggestedAction: { tool: 'log_habit', params: { name_match: habit.name } },
        });
        break;
      }
    }

    return insights;
  },

  async execute(step: PlanStep): Promise<ToolResult> {
    const tool = toolRegistry.get(step.tool);
    if (!tool) return { success: false, message: `Unknown tool: ${step.tool}` };
    const result = await tool.execute(step.params);
    eventBus.emit({ type: 'tool_result', tool: step.tool, params: step.params, result, domain: 'health' });
    return result;
  },

  async onEvent(event: AgentEvent): Promise<void> {
    if (event.type === 'tool_result' && event.tool === 'log_hydration' && event.result.success) {
      const state = useStore.getState();
      const hydrationGoals = state.goals.filter((g) => g.domain === 'health' && g.status === 'active' && g.unit === 'ml');
      for (const goal of hydrationGoals) {
        const ml = (event.params.amount_ml as number) || 250;
        await state.progressGoal(goal.id, ml);
        const updated = useStore.getState().goals.find((g) => g.id === goal.id);
        if (updated) {
          const pct = updated.targetValue ? Math.round((updated.currentValue / updated.targetValue) * 100) : 0;
          eventBus.emit({ type: 'goal_progress', goalId: goal.id, current: updated.currentValue, target: updated.targetValue ?? 0, pct });
        }
      }
    }
  },

  async briefing(): Promise<string> {
    const state = useStore.getState();
    const parts: string[] = [];

    const goal = state.hydrationGoalMl || 2500;
    const pct = Math.round((state.hydrationTodayMl / goal) * 100);
    parts.push(`Water: ${state.hydrationTodayMl}ml/${goal}ml (${pct}%)`);

    const lastSleep = state.sleepSessions[0];
    if (lastSleep && dayjs(lastSleep.sleep_end).isSame(dayjs(), 'day')) {
      const hrs = Math.round((lastSleep.duration_minutes / 60) * 10) / 10;
      parts.push(`Sleep: ${hrs}h`);
    }

    const todayMood = state.moodLogs.find((m) => dayjs(m.logged_at).isSame(dayjs(), 'day'));
    if (todayMood) {
      const emojis = ['', '😞', '😐', '🙂', '😊', '🤩'];
      parts.push(`Mood: ${emojis[todayMood.mood]} (${todayMood.mood}/5)`);
    }

    return parts.join(' | ');
  },
};
