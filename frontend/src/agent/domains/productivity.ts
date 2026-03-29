// PicoClaw — Productivity Domain Agent
// Owns: tasks, calendar, focus, time blocks
// Auto-plans days, monitors deadlines, suggests focus sessions.

import dayjs from 'dayjs';
import type { AgentEvent } from '../eventBus';
import { eventBus } from '../eventBus';
import type { AgentInsight, PlanStep, ToolResult } from '../types';
import type { DomainAgent } from './index';
import { toolRegistry } from '../tools';
import { useStore } from '../../store/useStore';

export const productivityAgent: DomainAgent = {
  name: 'productivity',
  domain: 'productivity',
  ownedTools: [
    'add_task', 'complete_task', 'delete_task', 'query_tasks',
    'query_calendar', 'create_event',
    'set_focus_mode',
    'create_time_block', 'query_time_blocks',
    'schedule_reminder',
  ],

  async assess(): Promise<AgentInsight[]> {
    const insights: AgentInsight[] = [];
    const state = useStore.getState();
    const now = dayjs();
    const today = now.format('YYYY-MM-DD');
    const hour = now.hour();

    // ── Overdue tasks ─────────────────────────────
    const overdue = state.tasks.filter(
      (t) => t.status === 'pending' && t.due_date && dayjs(t.due_date).isBefore(now, 'day'),
    );
    if (overdue.length > 0) {
      insights.push({
        domain: 'productivity',
        priority: 'high',
        title: `${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}`,
        body: overdue.slice(0, 3).map((t) => `- ${t.title} (due ${dayjs(t.due_date).format('MMM D')})`).join('\n'),
        coachingWhy: 'Stale tasks weigh on focus even when you\'re busy.',
        coachingTip: 'Pick one to reschedule honestly or close in 5 minutes.',
      });
    }

    // ── Tasks due today ───────────────────────────
    const dueToday = state.tasks.filter(
      (t) => t.status === 'pending' && t.due_date && dayjs(t.due_date).isSame(now, 'day'),
    );
    if (dueToday.length > 0 && hour >= 15) {
      const remaining = dueToday.length;
      insights.push({
        domain: 'productivity',
        priority: remaining >= 3 ? 'high' : 'low',
        title: `${remaining} task${remaining > 1 ? 's' : ''} due today`,
        body: dueToday.slice(0, 3).map((t) => `- ${t.title} (${t.priority})`).join('\n'),
        coachingTip: remaining >= 3 ? 'Which one matters if you only finish one?' : undefined,
      });
    }

    // ── Focus suggestion ──────────────────────────
    if (!state.focusEnabled && hour >= 9 && hour <= 17) {
      const highTasks = state.tasks.filter((t) => t.status === 'pending' && t.priority === 'high');
      // Check for calendar gap (no event in next 60min)
      const nextEvent = state.calendarEvents.find((e) =>
        dayjs(e.start_time).isAfter(now) && dayjs(e.start_time).diff(now, 'minute') <= 60,
      );
      if (highTasks.length > 0 && !nextEvent) {
        insights.push({
          domain: 'productivity',
          priority: 'low',
          title: 'Focus window',
          body: `You have ${highTasks.length} high-priority task${highTasks.length > 1 ? 's' : ''} and no meetings in the next hour. Start a focus session?`,
          coachingWhy: 'Protected blocks are when deep work actually ships.',
          suggestedAction: { tool: 'set_focus_mode', params: { enabled: true, durationMin: 45 } },
        });
      }
    }

    // ── Morning auto-plan ─────────────────────────
    if (hour >= 7 && hour <= 10) {
      const todayBlocks = state.timeBlocks.filter((b) => b.date === today);
      if (todayBlocks.length === 0) {
        const pendingCount = state.tasks.filter((t) => t.status === 'pending').length;
        const eventCount = state.calendarEvents.filter((e) => dayjs(e.start_time).isSame(now, 'day')).length;
        if (pendingCount > 0 || eventCount > 0) {
          insights.push({
            domain: 'productivity',
            priority: 'low',
            title: 'Shape the day',
            body: `${pendingCount} pending tasks and ${eventCount} events — want a simple time-block plan?`,
            coachingWhy: 'Writing the plan down beats holding it all in your head.',
          });
        }
      }
    }

    // ── Upcoming calendar event ───────────────────
    const upcoming = state.calendarEvents.find(
      (e) => {
        const minutesUntil = dayjs(e.start_time).diff(now, 'minute');
        return minutesUntil > 0 && minutesUntil <= 15;
      },
    );
    if (upcoming) {
      insights.push({
        domain: 'productivity',
        priority: 'high',
        title: `${upcoming.summary} starting soon`,
        body: `In ${dayjs(upcoming.start_time).diff(now, 'minute')} minutes${upcoming.location ? ` at ${upcoming.location}` : ''}`,
      });
    }

    // ── Task completion momentum ──────────────────
    const completedToday = state.tasks.filter(
      (t) => t.status === 'completed' && t.updated_at && dayjs(t.updated_at).isSame(now, 'day'),
    );
    const pendingToday = state.tasks.filter((t) => t.status === 'pending');
    if (completedToday.length >= 3 && pendingToday.length > 0) {
      insights.push({
        domain: 'productivity',
        priority: 'low',
        title: 'Great momentum!',
        body: `${completedToday.length} tasks done today. ${pendingToday.length} remaining — keep going!`,
      });
    }

    // ── Task aging — stale tasks pending > 3 days ──
    const staleTasks = pendingToday.filter(
      (t) => t.created_at && dayjs().diff(dayjs(t.created_at), 'day') > 3,
    );
    if (staleTasks.length > 0) {
      insights.push({
        domain: 'productivity',
        priority: 'low',
        title: `${staleTasks.length} task${staleTasks.length > 1 ? 's' : ''} aging`,
        body: `${staleTasks.map((t) => t.title).slice(0, 3).join(', ')}${staleTasks.length > 3 ? '...' : ''} — pending for 3+ days. Still relevant?`,
        coachingWhy: 'Stale tasks add cognitive weight. Delete, delegate, or do the smallest step.',
      });
    }

    // ── Priority imbalance ─────────────────────────
    const highPri = pendingToday.filter((t) => t.priority === 'high');
    if (pendingToday.length >= 5 && highPri.length / pendingToday.length > 0.6) {
      insights.push({
        domain: 'productivity',
        priority: 'low',
        title: 'Priority overload',
        body: `${highPri.length} of ${pendingToday.length} tasks are high priority. If everything is urgent, nothing is. Consider re-triaging.`,
        coachingWhy: 'A clear priority ladder helps you focus on what truly matters first.',
      });
    }

    return insights;
  },

  async execute(step: PlanStep): Promise<ToolResult> {
    const tool = toolRegistry.get(step.tool);
    if (!tool) return { success: false, message: `Unknown tool: ${step.tool}` };
    const result = await tool.execute(step.params);
    eventBus.emit({ type: 'tool_result', tool: step.tool, params: step.params, result, domain: 'productivity' });
    return result;
  },

  async onEvent(event: AgentEvent): Promise<void> {
    // Track goal progress when tasks are completed
    if (event.type === 'tool_result' && event.tool === 'complete_task' && event.result.success) {
      const state = useStore.getState();
      const taskGoals = state.goals.filter((g) => g.domain === 'productivity' && g.status === 'active');
      for (const goal of taskGoals) {
        await state.progressGoal(goal.id, 1);
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
    const now = dayjs();
    const parts: string[] = [];

    // Pending tasks
    const pending = state.tasks.filter((t) => t.status === 'pending');
    const dueToday = pending.filter((t) => t.due_date && dayjs(t.due_date).isSame(now, 'day'));
    parts.push(`Tasks: ${pending.length} pending${dueToday.length > 0 ? `, ${dueToday.length} due today` : ''}`);

    // Today's events
    const todayEvents = state.calendarEvents.filter((e) => dayjs(e.start_time).isSame(now, 'day'));
    if (todayEvents.length > 0) {
      parts.push(`Calendar: ${todayEvents.length} event${todayEvents.length > 1 ? 's' : ''}`);
      const next = todayEvents.find((e) => dayjs(e.start_time).isAfter(now));
      if (next) parts.push(`Next: ${next.summary} at ${dayjs(next.start_time).format('h:mm A')}`);
    }

    // Focus status
    if (state.focusEnabled) {
      parts.push(`Focus: active (${state.focusRemainingMin}min left)`);
    }

    return parts.join(' | ');
  },
};
