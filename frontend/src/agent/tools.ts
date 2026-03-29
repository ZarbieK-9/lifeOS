// PicoClaw Agent — Tool Registry
// Schemas + async executors backed by the Zustand store (LLM chooses tools)

import type { GoalDomain, PlanStep, Tool, ToolResult } from './types';
import { useStore } from '../store/useStore';
import { eventBus } from './eventBus';
import { withTimeout } from '../utils/timeout';
import dayjs from 'dayjs';

function ok(message: string, data?: unknown): ToolResult {
  return { success: true, message, data };
}

function fail(message: string): ToolResult {
  return { success: false, message };
}

// ── Goal-progress framing ─────────────────────────
// Maps tool names to goal domains so we can append progress context.
const TOOL_GOAL_DOMAINS: Record<string, { domain: string; unit?: string }> = {
  log_hydration: { domain: 'health', unit: 'ml' },
  complete_task: { domain: 'productivity', unit: 'tasks' },
  log_habit: { domain: 'health' },
  log_expense: { domain: 'finance' },
};

/** Enrich a tool result with active goal progress if applicable. */
function enrichWithGoalProgress(toolName: string, result: ToolResult): ToolResult {
  if (!result.success) return result;
  const mapping = TOOL_GOAL_DOMAINS[toolName];
  if (!mapping) return result;

  const goals = useStore.getState().goals.filter(
    (g) => g.domain === mapping.domain && g.status === 'active' && g.targetValue != null,
  );
  if (goals.length === 0) return result;

  const goal = goals[0]; // primary goal in this domain
  const pct = Math.round((goal.currentValue / goal.targetValue!) * 100);
  const progressNote = ` (${goal.title}: ${pct}% complete)`;
  return { ...result, message: result.message + progressNote };
}

// ── Tool definitions ──────────────────────────────────

const addTask: Tool = {
  name: 'add_task',
  description: 'Create a new task (optionally recurring)',
  params: {
    title: { type: 'string', required: true, description: 'Task title' },
    priority: { type: 'string', required: false, description: 'low, medium, or high' },
    dueDate: { type: 'string', required: false, description: 'Due date string' },
    notes: { type: 'string', required: false, description: 'Additional notes' },
    recurrence: { type: 'string', required: false, description: 'Recurrence pattern (e.g. "every Monday", "daily")' },
  },
  execute: async (params) => {
    const title = params.title as string;
    if (!title) return fail('No task title provided.');
    const priority = (params.priority as 'low' | 'medium' | 'high') || 'medium';
    const dueDate = (params.dueDate as string) || null;
    const notes = (params.notes as string) || '';
    const recurrence = (params.recurrence as string) || null;
    await useStore.getState().addTask(title, priority, dueDate, notes, recurrence);
    const recMsg = recurrence ? ` (recurring: ${recurrence})` : '';
    return ok(`Task created: "${title}" (${priority} priority)${recMsg}`);
  },
};

const completeTask: Tool = {
  name: 'complete_task',
  description: 'Mark a task as completed by fuzzy title match',
  params: {
    title_match: { type: 'string', required: true, description: 'Text to match against task titles' },
  },
  execute: async (params) => {
    const query = (params.title_match as string).toLowerCase();
    if (!query) return fail('No task title to match.');
    const tasks = useStore.getState().tasks.filter(t => t.status === 'pending');
    const match = tasks.find(t => t.title.toLowerCase().includes(query))
      || tasks.find(t => query.includes(t.title.toLowerCase()));
    if (!match) return fail(`No pending task matching "${params.title_match}".`);
    await useStore.getState().updateTask(match.task_id, { status: 'completed' });
    return ok(`Completed: "${match.title}"`);
  },
};

const deleteTask: Tool = {
  name: 'delete_task',
  description: 'Delete a task by fuzzy title match',
  params: {
    title_match: { type: 'string', required: true, description: 'Text to match against task titles' },
  },
  execute: async (params) => {
    const query = (params.title_match as string).toLowerCase();
    if (!query) return fail('No task title to match.');
    const tasks = useStore.getState().tasks;
    const match = tasks.find(t => t.title.toLowerCase().includes(query))
      || tasks.find(t => query.includes(t.title.toLowerCase()));
    if (!match) return fail(`No task matching "${params.title_match}".`);
    await useStore.getState().deleteTask(match.task_id);
    return ok(`Deleted: "${match.title}"`);
  },
};

const logHydration: Tool = {
  name: 'log_hydration',
  description: 'Log water intake',
  params: {
    amount_ml: { type: 'number', required: true, description: 'Amount in milliliters' },
  },
  execute: async (params) => {
    const ml = params.amount_ml as number || 250;
    await useStore.getState().logHydration(ml);
    const s = useStore.getState();
    const target = s.hydrationGoalMl || 2500;
    return ok(`Logged ${ml}ml of water. Today's total: ${s.hydrationTodayMl}ml / ${target}ml`);
  },
};

const setFocusMode: Tool = {
  name: 'set_focus_mode',
  description: 'Toggle focus mode on or off',
  params: {
    enabled: { type: 'boolean', required: true, description: 'Enable or disable focus mode' },
    durationMin: { type: 'number', required: false, description: 'Duration in minutes (default 45)' },
  },
  execute: async (params) => {
    const enabled = params.enabled as boolean;
    const duration = (params.durationMin as number) || 45;
    const current = useStore.getState().focusEnabled;
    if (enabled === current) {
      return ok(enabled ? `Focus mode is already active (${useStore.getState().focusRemainingMin}min remaining).` : 'Focus mode is already off.');
    }
    useStore.getState().toggleFocus(duration);
    return ok(enabled ? `Focus mode started for ${duration} minutes.` : 'Focus mode stopped.');
  },
};

const sendSnippet: Tool = {
  name: 'send_snippet',
  description: 'Send a message snippet to a partner',
  params: {
    content: { type: 'string', required: true, description: 'Message content' },
    partnerId: { type: 'string', required: false, description: 'Partner ID (defaults to first partner)' },
  },
  execute: async (params) => {
    const content = params.content as string;
    if (!content) return fail('No message content provided.');
    const partners = useStore.getState().partners;
    const partnerId = (params.partnerId as string) || partners[0]?.id || 'default';
    await useStore.getState().sendSnippet(partnerId, content);
    return ok(`Snippet sent: "${content}"`);
  },
};

const queryStatus: Tool = {
  name: 'query_status',
  description: 'Get an overview of current status (tasks, hydration, focus, sleep)',
  params: {},
  execute: async () => {
    const s = useStore.getState();
    const pending = s.tasks.filter(t => t.status === 'pending').length;
    const completed = s.tasks.filter(t => t.status === 'completed').length;
    const lines = [
      `Tasks: ${pending} pending, ${completed} completed`,
      `Hydration: ${s.hydrationTodayMl}ml / ${s.hydrationGoalMl || 2500}ml`,
      `Focus: ${s.focusEnabled ? `Active (${s.focusRemainingMin}min remaining)` : 'Off'}`,
      `Sleep: ${s.sleep.isAsleep ? 'Tracking' : s.sleep.durationMinutes ? `Last: ${s.sleep.durationMinutes}min` : 'No data'}`,
      `Online: ${s.isOnline ? 'Yes' : 'No'}${s.isAuthenticated ? ' (Backend connected)' : ''}`,
    ];
    if (s.queueCount > 0) lines.push(`Queued events: ${s.queueCount}`);
    if (s.isGoogleConnected) {
      lines.push(`Google: Connected (${s.googleEmail ?? 'unknown'})`);
      lines.push(`Calendar: ${s.calendarEvents.length} upcoming events`);
      lines.push(`Email: ${s.unreadEmailCount} unread`);
    }
    return ok(lines.join('\n'));
  },
};

const queryTasks: Tool = {
  name: 'query_tasks',
  description: 'List tasks with optional filter',
  params: {
    filter: { type: 'string', required: false, description: 'Filter: pending, completed, overdue, or all' },
  },
  execute: async (params) => {
    const filter = (params.filter as string) || 'pending';
    const tasks = useStore.getState().tasks;
    const filtered = filter === 'all' ? tasks : tasks.filter(t => t.status === filter);
    if (filtered.length === 0) return ok(`No ${filter} tasks.`);
    const lines = filtered.slice(0, 10).map((t, i) =>
      `${i + 1}. ${t.title}${t.priority !== 'medium' ? ` [${t.priority}]` : ''}${t.due_date ? ` (due: ${t.due_date})` : ''}`
    );
    const suffix = filtered.length > 10 ? `\n...and ${filtered.length - 10} more` : '';
    return ok(`${filter.charAt(0).toUpperCase() + filter.slice(1)} tasks (${filtered.length}):\n${lines.join('\n')}${suffix}`);
  },
};

const queryHydration: Tool = {
  name: 'query_hydration',
  description: 'Show today\'s hydration progress',
  params: {},
  execute: async () => {
    const s = useStore.getState();
    const total = s.hydrationTodayMl;
    const target = s.hydrationGoalMl || 2500;
    const pct = Math.round((total / target) * 100);
    const remaining = Math.max(0, target - total);
    let msg = `Hydration today: ${total}ml / ${target}ml (${pct}%)${remaining > 0 ? `. ${remaining}ml remaining.` : ' Target reached!'}`;
    if (s.hydrationReminderEnabled && s.nextHydrationReminderAt) {
      const next = dayjs(s.nextHydrationReminderAt).format('h:mm A');
      msg += `\nNext reminder: ${next} (~${s.hydrationDosePerReminder}ml)`;
    }
    return ok(msg);
  },
};

// ── Google Calendar + Gmail tools ─────────────────────

const queryCalendar: Tool = {
  name: 'query_calendar',
  description: 'Show upcoming calendar events',
  params: {
    range: { type: 'string', required: false, description: 'today, tomorrow, or week' },
  },
  execute: async (params) => {
    const s = useStore.getState();
    if (!s.isGoogleConnected) return fail('Google account not connected. Go to Settings to connect.');

    await s.syncCalendarEvents();
    const state = useStore.getState();
    const err = state.lastCalendarError;
    if (err) return fail(`Calendar sync failed: ${err}. Enable "Google Calendar API" in Google Cloud Console (APIs & Services → Library) and try again.`);
    const events = state.calendarEvents;

    const range = (params.range as string) || 'today';
    const now = dayjs();
    let filtered = events;
    if (range === 'today') {
      filtered = events.filter(e => dayjs(e.start_time).isSame(now, 'day'));
    } else if (range === 'tomorrow') {
      const tom = now.add(1, 'day');
      filtered = events.filter(e => dayjs(e.start_time).isSame(tom, 'day'));
    } else if (range === 'week') {
      const weekEnd = now.add(7, 'day');
      filtered = events.filter(e => dayjs(e.start_time).isBefore(weekEnd));
    }

    if (filtered.length === 0) return ok(`No events ${range}.`);
    const lines = filtered.slice(0, 10).map((e, i) => {
      const time = e.all_day ? 'All day' : dayjs(e.start_time).format('HH:mm');
      return `${i + 1}. ${time} — ${e.summary}${e.location ? ` (${e.location})` : ''}`;
    });
    const suffix = filtered.length > 10 ? `\n...and ${filtered.length - 10} more` : '';
    return ok(`Calendar ${range} (${filtered.length} events):\n${lines.join('\n')}${suffix}`);
  },
};

const createEvent: Tool = {
  name: 'create_event',
  description: 'Create a Google Calendar event',
  params: {
    summary: { type: 'string', required: true, description: 'Event title' },
    hour: { type: 'number', required: false, description: 'Start hour (24h)' },
    minute: { type: 'number', required: false, description: 'Start minute' },
    tomorrow: { type: 'boolean', required: false, description: 'Schedule for tomorrow' },
  },
  execute: async (params) => {
    const s = useStore.getState();
    if (!s.isGoogleConnected) return fail('Google account not connected. Go to Settings to connect.');

    const summary = params.summary as string;
    if (!summary) return fail('No event title provided.');

    const hour = params.hour as number | null;
    const minute = (params.minute as number) ?? 0;
    const isTomorrow = params.tomorrow as boolean;

    let start = isTomorrow ? dayjs().add(1, 'day') : dayjs();
    if (hour !== null && hour !== undefined) {
      start = start.hour(hour).minute(minute).second(0);
    } else {
      start = start.add(1, 'hour').minute(0).second(0);
    }
    const end = start.add(1, 'hour');

    const result = await s.addCalendarEvent({
      summary,
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
    });
    if (!result.ok) return fail(result.error ?? 'Failed to create event. Enable "Google Calendar API" in Google Cloud Console (APIs & Services → Library).');
    return ok(`Event created: "${summary}" at ${start.format('MMM D, HH:mm')}`);
  },
};

const queryEmails: Tool = {
  name: 'query_emails',
  description: 'Show emails from inbox with optional category filter',
  params: {
    filter: { type: 'string', required: false, description: 'unread, important, action_needed, or newsletter' },
  },
  execute: async (params) => {
    const s = useStore.getState();
    if (!s.isGoogleConnected) return fail('Google account not connected. Go to Settings to connect.');

    await s.syncEmails();
    const state = useStore.getState();
    const err = state.lastEmailError;
    if (err) return fail(`Email sync failed: ${err}. Enable "Gmail API" in Google Cloud Console (APIs & Services → Library) and try again.`);
    const emails = state.emails;
    const filter = (params.filter as string) || 'unread';

    let filtered = emails;
    if (filter === 'unread') {
      filtered = emails.filter(e => e.is_unread);
    } else if (filter === 'important' || filter === 'action_needed' || filter === 'newsletter') {
      filtered = emails.filter(e => e.category === filter);
    }

    if (filtered.length === 0) return ok(`No ${filter} emails.`);
    const lines = filtered.slice(0, 8).map((e, i) => {
      const from = e.from_address.replace(/<.*>/, '').trim();
      const cat = e.category ? ` [${e.category}]` : '';
      return `${i + 1}. ${from}: ${e.subject}${cat}`;
    });
    const suffix = filtered.length > 8 ? `\n...and ${filtered.length - 8} more` : '';
    return ok(`${filter.charAt(0).toUpperCase() + filter.slice(1)} emails (${filtered.length}):\n${lines.join('\n')}${suffix}`);
  },
};

const triageEmails: Tool = {
  name: 'triage_emails',
  description: 'Categorize inbox emails into important/action_needed/fyi/newsletter',
  params: {},
  execute: async () => {
    const s = useStore.getState();
    if (!s.isGoogleConnected) return fail('Google account not connected. Go to Settings to connect.');

    if (s.emails.length === 0) {
      await s.syncEmails();
      const err = useStore.getState().lastEmailError;
      if (err) return fail(`Email sync failed: ${err}. Enable "Gmail API" in Google Cloud Console (APIs & Services → Library).`);
    }
    await s.triageEmails();

    const emails = useStore.getState().emails;
    const counts = { important: 0, action_needed: 0, fyi: 0, newsletter: 0 };
    for (const e of emails) {
      if (e.category && e.category in counts) counts[e.category]++;
    }

    return ok(
      `Inbox triaged (${emails.length} emails):\n` +
      `Important: ${counts.important}\n` +
      `Action needed: ${counts.action_needed}\n` +
      `FYI: ${counts.fyi}\n` +
      `Newsletter: ${counts.newsletter}`
    );
  },
};

const extractTasksFromEmailTool: Tool = {
  name: 'extract_tasks_from_email',
  description: 'Extract action items from emails and create tasks',
  params: {},
  execute: async () => {
    const s = useStore.getState();
    if (!s.isGoogleConnected) return fail('Google account not connected. Go to Settings to connect.');

    if (s.emails.length === 0) {
      await s.syncEmails();
      const err = useStore.getState().lastEmailError;
      if (err) return fail(`Email sync failed: ${err}. Enable "Gmail API" in Google Cloud Console (APIs & Services → Library).`);
    }
    if (!useStore.getState().emails.some(e => e.category)) await s.triageEmails();

    const tasks = await s.extractTasksFromEmails();
    if (tasks.length === 0) return ok('No action items found in emails.');
    return ok(`Extracted ${tasks.length} task(s) from emails:\n${tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}`);
  },
};

// ── Hydration reminder tools ──────────────────────────

const setHydrationReminderTool: Tool = {
  name: 'set_hydration_reminder',
  description: 'Set up hydration reminders with a time range and daily goal',
  params: {
    startHour: { type: 'number', required: true, description: 'Start hour (0-23)' },
    endHour: { type: 'number', required: true, description: 'End hour (0-23)' },
    goalMl: { type: 'number', required: true, description: 'Daily water goal in ml' },
  },
  execute: async (params) => {
    const startHour = params.startHour as number;
    const endHour = params.endHour as number;
    const goalMl = params.goalMl as number;

    if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) {
      return fail('Invalid hours. Use 0-23 range.');
    }
    if (startHour >= endHour) {
      return fail('Start hour must be before end hour.');
    }
    if (goalMl < 100 || goalMl > 10000) {
      return fail('Goal must be between 100ml and 10000ml.');
    }

    useStore.getState().setHydrationReminder(startHour, endHour, goalMl);
    const s = useStore.getState();
    const intervalH = Math.floor(s.hydrationIntervalMin / 60);
    const intervalM = s.hydrationIntervalMin % 60;
    const intervalStr = intervalH > 0 ? `${intervalH}h ${intervalM}m` : `${intervalM}m`;

    return ok(
      `Hydration reminders set: ${startHour}:00–${endHour}:00, ` +
      `goal ${goalMl}ml, ~${s.hydrationDosePerReminder}ml every ${intervalStr}`
    );
  },
};

const disableHydrationReminderTool: Tool = {
  name: 'disable_hydration_reminder',
  description: 'Turn off hydration reminders',
  params: {},
  execute: async () => {
    useStore.getState().disableHydrationReminder();
    return ok('Hydration reminders disabled.');
  },
};

// ── API Keys ──────────────────────────────────────────

const createApiKeyTool: Tool = {
  name: 'create_api_key',
  description: 'Generate a new API key for external integrations (Tasker, webhooks)',
  params: {
    name: { type: 'string', required: true, description: 'Label for the key (e.g. "Tasker")' },
  },
  execute: async (params) => {
    const { api } = require('../services/api') as typeof import('../services/api');
    const name = (params.name as string) || 'default';
    const result = await api.createApiKey(name);
    if (!result.ok) return fail(`Failed to create API key: ${result.error}`);
    return ok(
      `API key "${name}" created.\n` +
      `Key: ${result.data.api_key}\n` +
      `Save this key — it cannot be shown again.\n` +
      `Use: POST /v1/webhook/command with header X-API-Key`
    );
  },
};

const listApiKeysTool: Tool = {
  name: 'list_api_keys',
  description: 'Show all API keys for external integrations',
  params: {},
  execute: async () => {
    const { api } = require('../services/api') as typeof import('../services/api');
    const result = await api.listApiKeys();
    if (!result.ok) return fail(`Failed to list API keys: ${result.error}`);
    const keys = result.data.keys;
    if (keys.length === 0) return ok('No API keys. Say "generate api key for Tasker" to create one.');
    const lines = keys.map((k, i) =>
      `${i + 1}. ${k.name} (${k.key_prefix}...) ${k.last_used ? `— last used ${dayjs(k.last_used).format('MMM D')}` : '— never used'}`
    );
    return ok(`API Keys (${keys.length}):\n${lines.join('\n')}`);
  },
};

const revokeApiKeyTool: Tool = {
  name: 'revoke_api_key',
  description: 'Revoke an API key by name',
  params: {
    name_match: { type: 'string', required: true, description: 'Name of the key to revoke' },
  },
  execute: async (params) => {
    const { api } = require('../services/api') as typeof import('../services/api');
    const query = (params.name_match as string).toLowerCase();
    const listResult = await api.listApiKeys();
    if (!listResult.ok) return fail(`Failed to list keys: ${listResult.error}`);
    const match = listResult.data.keys.find(k => k.name.toLowerCase().includes(query));
    if (!match) return fail(`No API key matching "${params.name_match}".`);
    const revokeResult = await api.revokeApiKey(match.key_id);
    if (!revokeResult.ok) return fail(`Failed to revoke: ${revokeResult.error}`);
    return ok(`Revoked API key "${match.name}".`);
  },
};

// ── Sleep tools ───────────────────────────────────────

const logSleep: Tool = {
  name: 'log_sleep',
  description: 'Start/stop sleep tracking or log a sleep session',
  params: {
    action: { type: 'string', required: true, description: 'start, stop, or log' },
    time: { type: 'string', required: false, description: 'Time string (e.g. "11pm")' },
  },
  execute: async (params) => {
    const action = params.action as string;
    const s = useStore.getState();

    if (action === 'start') {
      const now = dayjs().toISOString();
      s.setSleep({ isAsleep: true, sleepStart: now, sleepEnd: null, durationMinutes: 0 });
      return ok(`Sleep tracking started at ${dayjs().format('h:mm A')}.`);
    }

    if (action === 'stop') {
      if (!s.sleep.isAsleep || !s.sleep.sleepStart) {
        return fail('No active sleep session to stop.');
      }
      const end = dayjs().toISOString();
      const durationMin = dayjs(end).diff(dayjs(s.sleep.sleepStart), 'minute');
      s.setSleep({ isAsleep: false, sleepEnd: end, durationMinutes: durationMin });
      await s.addSleepSession(s.sleep.sleepStart, end, durationMin);
      const hours = Math.floor(durationMin / 60);
      const mins = durationMin % 60;
      return ok(`Sleep logged: ${hours}h ${mins}m (${dayjs(s.sleep.sleepStart).format('h:mm A')} → ${dayjs(end).format('h:mm A')})`);
    }

    // Manual log — "log sleep" with optional time
    return ok('Use "start sleep" to begin tracking, or "stop sleep" to end and log your session.');
  },
};

const querySleep: Tool = {
  name: 'query_sleep',
  description: 'Show sleep stats for today or this week',
  params: {
    period: { type: 'string', required: false, description: 'today or week' },
  },
  execute: async (params) => {
    const period = (params.period as string) || 'today';
    await useStore.getState().loadSleepSessions(period as 'today' | 'week');
    const sessions = useStore.getState().sleepSessions;

    if (sessions.length === 0) return ok(`No sleep sessions recorded ${period === 'week' ? 'this week' : 'today'}.`);

    const totalMin = sessions.reduce((sum, s) => sum + s.duration_minutes, 0);
    const avgMin = Math.round(totalMin / sessions.length);
    const totalH = Math.floor(totalMin / 60);
    const totalM = totalMin % 60;
    const avgH = Math.floor(avgMin / 60);
    const avgM = avgMin % 60;

    const lines = [
      `Sleep ${period === 'week' ? 'this week' : 'today'}: ${sessions.length} session(s)`,
      `Total: ${totalH}h ${totalM}m`,
      `Average: ${avgH}h ${avgM}m per session`,
    ];
    return ok(lines.join('\n'));
  },
};

// ── Settings tool ─────────────────────────────────────

const updateSetting: Tool = {
  name: 'update_setting',
  description: 'Change a setting like hydration goal or focus duration',
  params: {
    setting: { type: 'string', required: true, description: 'Setting key' },
    value: { type: 'number', required: true, description: 'New value' },
  },
  execute: async (params) => {
    const setting = params.setting as string;
    const value = params.value as number;

    if (!value && value !== 0) return fail('No value provided for the setting.');

    const s = useStore.getState();
    switch (setting) {
      case 'hydration_goal': {
        const ml = typeof value === 'number' ? value : 2500;
        s.setHydrationReminder(s.hydrationStartHour, s.hydrationEndHour, ml);
        return ok(`Hydration goal updated to ${ml}ml (${(ml / 1000).toFixed(1)}L) per day.`);
      }
      case 'focus_duration': {
        const { kv } = require('../db/mmkv') as typeof import('../db/mmkv');
        kv.set('focus_duration', value);
        return ok(`Default focus duration set to ${value} minutes.`);
      }
      default:
        return fail(`Unknown setting: "${setting}". Supported: hydration goal, focus duration.`);
    }
  },
};

// ── Reminder tool ─────────────────────────────────────

const scheduleReminder: Tool = {
  name: 'schedule_reminder',
  description: 'Schedule a push notification reminder',
  params: {
    text: { type: 'string', required: true, description: 'Reminder text' },
    hour: { type: 'number', required: false, description: 'Hour (24h)' },
    minute: { type: 'number', required: false, description: 'Minute' },
  },
  execute: async (params) => {
    const text = params.text as string;
    if (!text) return fail('No reminder text provided.');

    const hour = params.hour as number | null;
    const minute = (params.minute as number) ?? 0;

    let triggerAt: string;
    if (hour !== null && hour !== undefined) {
      let target = dayjs().hour(hour).minute(minute).second(0);
      // If the time already passed today, schedule for tomorrow
      if (target.isBefore(dayjs())) {
        target = target.add(1, 'day');
      }
      triggerAt = target.toISOString();
    } else {
      // Default: 30 minutes from now
      triggerAt = dayjs().add(30, 'minute').toISOString();
    }

    await useStore.getState().addReminder(text, triggerAt);
    return ok(`Reminder set: "${text}" at ${dayjs(triggerAt).format('MMM D, h:mm A')}`);
  },
};

// ── Automation rule tool ──────────────────────────────

const createAutomationRuleTool: Tool = {
  name: 'create_automation_rule',
  description: 'Create an automation rule from natural language (e.g. "every weekday at 9am add task standup")',
  params: {
    raw: { type: 'string', required: true, description: 'Raw user input' },
  },
  execute: async (params) => {
    const raw = params.raw as string;
    const lower = raw.toLowerCase();

    // Parse "every X at Y do Z" pattern
    const cronMatch = lower.match(
      /(?:every\s+)?(weekday|daily|monday|tuesday|wednesday|thursday|friday|saturday|sunday|day)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(.+)/i
    );

    if (!cronMatch) {
      return fail(
        'Could not parse automation rule. Try: "every weekday at 9am add task standup" or "every Monday at 8am remind me to plan the week"'
      );
    }

    const [, dayPart, hourStr, minStr, ampm, actionPart] = cronMatch;
    let hour = parseInt(hourStr);
    const minute = minStr ? parseInt(minStr) : 0;
    if (ampm?.toLowerCase() === 'pm' && hour < 12) hour += 12;
    if (ampm?.toLowerCase() === 'am' && hour === 12) hour = 0;

    // Build cron expression
    let cron: string;
    const dl = dayPart.toLowerCase();
    const dayMap: Record<string, string> = {
      sunday: '0', monday: '1', tuesday: '2', wednesday: '3',
      thursday: '4', friday: '5', saturday: '6',
    };

    if (dl === 'daily' || dl === 'day') {
      cron = `${minute} ${hour} * * *`;
    } else if (dl === 'weekday') {
      cron = `${minute} ${hour} * * 1-5`;
    } else if (dayMap[dl]) {
      cron = `${minute} ${hour} * * ${dayMap[dl]}`;
    } else {
      cron = `${minute} ${hour} * * *`;
    }

    const name = `Auto: ${actionPart.slice(0, 40)}`;
    await useStore.getState().addAutomationRule({
      name,
      description: raw,
      ruleType: 'schedule',
      schedule: cron,
      condition: null,
      actions: [{ tool: 'add_task', params: { title: actionPart.trim() } }],
      enabled: true,
    });

    return ok(`Automation rule created: "${name}"\nSchedule: ${cron} (${dayPart} at ${hour}:${minute.toString().padStart(2, '0')})`);
  },
};

// ── Webhook info tool ─────────────────────────────────

const showWebhookInfo: Tool = {
  name: 'show_webhook_info',
  description: 'Show instructions for connecting Tasker or other webhook tools',
  params: {},
  execute: async () => {
    const { kv } = require('../db/mmkv') as typeof import('../db/mmkv');
    const backendUrl = kv.getString('backend_url') || 'http://<your-server>:8080';
    const lines = [
      'Webhook Integration Setup:',
      '',
      `Endpoint: POST ${backendUrl}/v1/webhook/command`,
      'Headers: Content-Type: application/json, X-API-Key: <your-key>',
      'Body: { "command": "log 500ml water" }',
      '',
      'Steps:',
      '1. Say "generate api key for Tasker" to create a key',
      '2. Copy the key (it\'s shown only once)',
      '3. In Tasker, create an HTTP Request action with the above details',
      '4. Send any PicoClaw command through the webhook',
      '',
      'Supported commands: all PicoClaw commands (log water, add task, etc.)',
    ];
    return ok(lines.join('\n'));
  },
};

// ── Registry ──────────────────────────────────────────

// ── Habit tools ──

const addHabit: Tool = {
  name: 'add_habit',
  description: 'Create a new trackable habit',
  params: {
    name: { type: 'string', required: true, description: 'Habit name (e.g. "Exercise", "Read")' },
    icon: { type: 'string', required: false, description: 'Emoji icon for the habit' },
    target_per_day: { type: 'number', required: false, description: 'Daily target count (default 1)' },
    unit: { type: 'string', required: false, description: 'Unit label (e.g. "minutes", "pages")' },
  },
  execute: async (params) => {
    const name = params.name as string;
    if (!name) return fail('No habit name provided.');
    const icon = (params.icon as string) || '✓';
    const target = (params.target_per_day as number) || 1;
    const unit = (params.unit as string) || null;
    await useStore.getState().addHabit(name, icon, target, unit);
    return ok(`Habit created: "${name}" (target: ${target}${unit ? ` ${unit}` : ''}/day)`);
  },
};

const logHabitTool: Tool = {
  name: 'log_habit',
  description: 'Log a habit entry by fuzzy name match',
  params: {
    name_match: { type: 'string', required: true, description: 'Text to match against habit names' },
    value: { type: 'number', required: false, description: 'Value to log (default 1)' },
  },
  execute: async (params) => {
    const query = (params.name_match as string).toLowerCase();
    if (!query) return fail('No habit name to match.');
    const habits = useStore.getState().habits.filter(h => h.enabled);
    const match = habits.find(h => h.name.toLowerCase().includes(query))
      || habits.find(h => query.includes(h.name.toLowerCase()));
    if (!match) return fail(`No habit matching "${query}". Available: ${habits.map(h => h.name).join(', ')}`);
    const value = (params.value as number) || 1;
    await useStore.getState().logHabitEntry(match.id, value);
    return ok(`Logged ${value}${match.unit ? ` ${match.unit}` : ''} for "${match.name}"`);
  },
};

const deleteHabitTool: Tool = {
  name: 'delete_habit',
  description: 'Delete a habit by fuzzy name match',
  params: {
    name_match: { type: 'string', required: true, description: 'Text to match against habit names' },
  },
  execute: async (params) => {
    const query = (params.name_match as string).toLowerCase();
    if (!query) return fail('No habit name to match.');
    const habits = useStore.getState().habits;
    const match = habits.find(h => h.name.toLowerCase().includes(query));
    if (!match) return fail(`No habit matching "${query}".`);
    await useStore.getState().deleteHabit(match.id);
    return ok(`Deleted habit: "${match.name}"`);
  },
};

// ── Memory tools ──

const queryMemories: Tool = {
  name: 'query_memories',
  description: 'Show what the AI remembers about the user',
  params: {
    category: { type: 'string', required: false, description: 'Filter by category (e.g. general, preference, health)' },
  },
  execute: async (params) => {
    const memories = useStore.getState().aiMemories;
    const category = params.category as string | undefined;
    const filtered = category ? memories.filter(m => m.category === category) : memories;
    if (filtered.length === 0) return ok(category ? `No memories in category "${category}".` : 'No memories stored yet.');
    const lines = filtered.slice(0, 20).map((m, i) =>
      `${i + 1}. [${m.category}] ${m.fact}`
    );
    return ok(`Memories (${filtered.length}):\n${lines.join('\n')}`);
  },
};

const deleteMemory: Tool = {
  name: 'delete_memory',
  description: 'Delete a stored memory by fuzzy text match',
  params: {
    fact_match: { type: 'string', required: true, description: 'Text to match against stored facts' },
  },
  execute: async (params) => {
    const query = (params.fact_match as string).toLowerCase();
    if (!query) return fail('No text to match.');
    const memories = useStore.getState().aiMemories;
    const match = memories.find(m => m.fact.toLowerCase().includes(query));
    if (!match) return fail(`No memory matching "${params.fact_match}".`);
    await useStore.getState().deleteAiMemory(match.id);
    return ok(`Deleted memory: "${match.fact}"`);
  },
};

// ── Mood & Energy tools ──

const logMood: Tool = {
  name: 'log_mood',
  description: 'Log mood and energy levels (1-5 each)',
  params: {
    mood: { type: 'number', required: true, description: 'Mood level 1-5 (1=terrible, 5=amazing)' },
    energy: { type: 'number', required: true, description: 'Energy level 1-5 (1=exhausted, 5=energized)' },
    note: { type: 'string', required: false, description: 'Optional note about how you feel' },
  },
  execute: async (params) => {
    const mood = Math.min(5, Math.max(1, Math.round(params.mood as number)));
    const energy = Math.min(5, Math.max(1, Math.round(params.energy as number)));
    const note = params.note as string | undefined;
    await useStore.getState().addMoodLog(mood, energy, note);
    const moodEmoji = ['', '😞', '😐', '🙂', '😊', '🤩'][mood];
    const energyEmoji = ['', '🪫', '😴', '⚡', '🔋', '⚡⚡'][energy];
    return ok(`Logged mood: ${moodEmoji} ${mood}/5, energy: ${energyEmoji} ${energy}/5${note ? ` — "${note}"` : ''}`);
  },
};

const queryMood: Tool = {
  name: 'query_mood',
  description: 'Show mood and energy trends',
  params: {},
  execute: async () => {
    const logs = useStore.getState().moodLogs;
    if (logs.length === 0) return ok('No mood logs yet. Try "log my mood".');
    const recent = logs.slice(0, 7);
    const avgMood = (recent.reduce((s, l) => s + l.mood, 0) / recent.length).toFixed(1);
    const avgEnergy = (recent.reduce((s, l) => s + l.energy, 0) / recent.length).toFixed(1);
    const lines = [
      `Mood & Energy (last ${recent.length} entries):`,
      `Avg mood: ${avgMood}/5, Avg energy: ${avgEnergy}/5`,
      ...recent.slice(0, 5).map(l =>
        `${dayjs(l.logged_at).format('ddd h:mm A')}: mood ${l.mood}/5, energy ${l.energy}/5${l.note ? ` — ${l.note}` : ''}`
      ),
    ];
    return ok(lines.join('\n'));
  },
};

// ── Note tools ──

const addNoteTool: Tool = {
  name: 'add_note',
  description: 'Create a note or journal entry',
  params: {
    title: { type: 'string', required: true, description: 'Note title' },
    body: { type: 'string', required: false, description: 'Note body' },
    journal: { type: 'boolean', required: false, description: 'True for journal entry' },
  },
  execute: async (params) => {
    const title = params.title as string;
    if (!title) return fail('No note title provided.');
    const body = (params.body as string) || '';
    const category = params.journal ? 'journal' as const : 'note' as const;
    await useStore.getState().addNote(title, body, category);
    return ok(`${category === 'journal' ? 'Journal entry' : 'Note'} created: "${title}"`);
  },
};

const queryNotes: Tool = {
  name: 'query_notes',
  description: 'Search notes by keyword',
  params: {
    query: { type: 'string', required: false, description: 'Search keyword' },
  },
  execute: async (params) => {
    const notes = useStore.getState().notes;
    const q = ((params.query as string) || '').toLowerCase();
    const filtered = q ? notes.filter(n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)) : notes;
    if (filtered.length === 0) return ok(q ? `No notes matching "${q}".` : 'No notes yet.');
    const lines = filtered.slice(0, 10).map((n, i) =>
      `${i + 1}. ${n.pinned ? '📌 ' : ''}[${n.category}] ${n.title} — ${dayjs(n.updated_at).format('MMM D')}`
    );
    return ok(`Notes (${filtered.length}):\n${lines.join('\n')}`);
  },
};

// ── Inbox tools ──

const triageInbox: Tool = {
  name: 'triage_inbox',
  description: 'Process untriaged inbox items — categorize and create tasks/notes as needed',
  params: {},
  execute: async () => {
    const items = useStore.getState().inboxItems.filter(i => !i.triaged);
    if (items.length === 0) return ok('Inbox is empty. Nothing to triage.');
    const results: string[] = [];
    for (const item of items.slice(0, 10)) {
      const lower = item.text.toLowerCase();
      let result = 'idea';
      if (lower.match(/\b(todo|task|do|finish|complete|submit|buy|get)\b/)) {
        result = 'task';
        await useStore.getState().addTask(item.text);
        results.push(`Task: "${item.text}"`);
      } else if (lower.match(/\b(remind|reminder|don't forget|remember to)\b/)) {
        result = 'reminder';
        results.push(`Reminder: "${item.text}"`);
      } else if (lower.match(/\b(note|thought|idea|journal)\b/)) {
        result = 'note';
        await useStore.getState().addNote(item.text, '', 'note');
        results.push(`Note: "${item.text}"`);
      } else {
        results.push(`Idea: "${item.text}"`);
      }
      await useStore.getState().triageInboxItem(item.id, result);
    }
    return ok(`Triaged ${results.length} items:\n${results.join('\n')}`);
  },
};

// ── Time Block tools ──

const createTimeBlock: Tool = {
  name: 'create_time_block',
  description: 'Create a time block for today (e.g. "block 2pm-3pm for deep work")',
  params: {
    title: { type: 'string', required: true, description: 'Block title' },
    start_hour: { type: 'number', required: true, description: 'Start hour (24h)' },
    start_minute: { type: 'number', required: false, description: 'Start minute' },
    end_hour: { type: 'number', required: true, description: 'End hour (24h)' },
    end_minute: { type: 'number', required: false, description: 'End minute' },
  },
  execute: async (params) => {
    const title = params.title as string;
    if (!title) return fail('No block title provided.');
    const today = dayjs().format('YYYY-MM-DD');
    const startH = params.start_hour as number;
    const startM = (params.start_minute as number) ?? 0;
    const endH = params.end_hour as number;
    const endM = (params.end_minute as number) ?? 0;
    const start = dayjs().hour(startH).minute(startM).second(0).toISOString();
    const end = dayjs().hour(endH).minute(endM).second(0).toISOString();
    await useStore.getState().addTimeBlock(title, start, end, today, 'ai');
    return ok(`Time block created: "${title}" ${startH}:${String(startM).padStart(2, '0')}-${endH}:${String(endM).padStart(2, '0')}`);
  },
};

const queryTimeBlocks: Tool = {
  name: 'query_time_blocks',
  description: 'Show today\'s time blocks',
  params: {},
  execute: async () => {
    const blocks = useStore.getState().timeBlocks;
    if (blocks.length === 0) return ok('No time blocks scheduled today.');
    const lines = blocks.map((b, i) =>
      `${i + 1}. ${dayjs(b.start_time).format('h:mm A')}-${dayjs(b.end_time).format('h:mm A')}: ${b.title}`
    );
    return ok(`Today's time blocks (${blocks.length}):\n${lines.join('\n')}`);
  },
};

// ── Expense tools ──

const logExpense: Tool = {
  name: 'log_expense',
  description: 'Log a spending entry (amount + category)',
  params: {
    amount: { type: 'number', required: true, description: 'Amount spent' },
    category: { type: 'string', required: false, description: 'Category (food, transport, coffee, groceries, etc.)' },
    description: { type: 'string', required: false, description: 'What it was for' },
  },
  execute: async (params) => {
    const amount = params.amount as number;
    if (!amount || amount <= 0) return fail('Invalid amount.');
    const category = (params.category as string) || 'other';
    const description = params.description as string | undefined;
    await useStore.getState().addExpense(amount, category, description);
    const s = useStore.getState();
    return ok(`Logged $${amount.toFixed(2)} (${category})${description ? ` — ${description}` : ''}. Today: $${s.todaySpend.toFixed(2)}, Month: $${s.monthSpend.toFixed(2)}`);
  },
};

const queryExpenses: Tool = {
  name: 'query_expenses',
  description: 'Show expense breakdown',
  params: {
    period: { type: 'string', required: false, description: 'today, week, or month' },
  },
  execute: async () => {
    const s = useStore.getState();
    const expenses = s.expenses;
    if (expenses.length === 0) return ok('No expenses logged this month.');
    const byCategory = new Map<string, number>();
    for (const e of expenses) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
    }
    const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
    const lines = [
      `Expenses this month: $${s.monthSpend.toFixed(2)}`,
      `Today: $${s.todaySpend.toFixed(2)}`,
      '',
      'By category:',
      ...sorted.map(([cat, amt]) => `  ${cat}: $${amt.toFixed(2)}`),
    ];
    // Check budgets
    for (const b of s.budgets) {
      const spent = byCategory.get(b.category) ?? 0;
      if (spent > b.monthly_limit * 0.8) {
        lines.push(`\n⚠️ ${b.category}: $${spent.toFixed(2)} / $${b.monthly_limit.toFixed(2)} budget`);
      }
    }
    return ok(lines.join('\n'));
  },
};

const setBudgetTool: Tool = {
  name: 'set_budget',
  description: 'Set a monthly budget for a spending category',
  params: {
    category: { type: 'string', required: true, description: 'Category name' },
    monthly_limit: { type: 'number', required: true, description: 'Monthly limit in dollars' },
  },
  execute: async (params) => {
    const category = params.category as string;
    const limit = params.monthly_limit as number;
    if (!category || !limit) return fail('Need category and monthly_limit.');
    await useStore.getState().setBudget(category, limit);
    return ok(`Budget set: ${category} — $${limit.toFixed(2)}/month`);
  },
};

const createGoalTool: Tool = {
  name: 'create_goal',
  description:
    'Create a tracked goal. Optionally pass plan_steps_json: a JSON array of { "tool": string, "params": object } for setup (e.g. set_hydration_reminder, add_habit, schedule_reminder). Use when the user commits to an outcome; otherwise use action tools directly (add_task, log_hydration, …).',
  params: {
    title: { type: 'string', required: true, description: 'Short goal title' },
    domain: {
      type: 'string',
      required: true,
      description: 'One of: health, productivity, finance, social',
    },
    description: { type: 'string', required: false, description: 'One sentence' },
    target_value: { type: 'number', required: false, description: 'Numeric target if applicable' },
    unit: { type: 'string', required: false, description: 'e.g. ml, tasks, USD' },
    deadline: { type: 'string', required: false, description: 'YYYY-MM-DD' },
    plan_steps_json: {
      type: 'string',
      required: false,
      description:
        'Optional JSON array of {tool, params} for validated setup steps executed after the goal is created',
    },
  },
  execute: async (params) => {
    const title = (params.title as string)?.trim();
    if (!title) return fail('title is required');
    const domainRaw = (params.domain as string)?.toLowerCase().trim();
    const validDomains: GoalDomain[] = ['health', 'productivity', 'finance', 'social'];
    if (!domainRaw || !validDomains.includes(domainRaw as GoalDomain)) {
      return fail(`domain must be one of: ${validDomains.join(', ')}`);
    }
    const domain = domainRaw as GoalDomain;

    const store = useStore.getState();
    const dup = store.goals.find(
      (g) => g.domain === domain && g.status === 'active' && g.title.toLowerCase() === title.toLowerCase(),
    );
    if (dup) {
      return fail(`You already have an active goal "${dup.title}" in ${domain}.`);
    }

    const goalId = await store.addGoal({
      title,
      description: (params.description as string)?.trim() || null,
      domain,
      targetValue: params.target_value != null ? Number(params.target_value) : null,
      unit: (params.unit as string)?.trim() || null,
      deadline: (params.deadline as string)?.trim() || null,
    });

    eventBus.emit({ type: 'goal_created', goalId, domain, title });

    const raw = (params.plan_steps_json as string | undefined)?.trim();
    if (!raw) {
      const t = params.target_value != null ? ` Target: ${params.target_value} ${params.unit ?? ''}.` : '';
      return ok(`Goal created: "${title}" (${domain}).${t} I'll track your progress.`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail('plan_steps_json must be valid JSON.');
    }
    if (!Array.isArray(parsed)) {
      return fail('plan_steps_json must be a JSON array of { tool, params }.');
    }

    const { uid } = await import('../db/database');
    const { executePlan } = await import('./executor');
    const validatedSteps: PlanStep[] = [];

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const tool = (item as { tool?: string }).tool;
      const p = (item as { params?: Record<string, unknown> }).params ?? {};
      if (typeof tool !== 'string') continue;
      const vs = validatePlanStep({ tool, params: p });
      if (vs.ok) {
        validatedSteps.push({
          id: uid(),
          tool,
          params: vs.params ?? {},
          status: 'pending',
        });
      }
    }

    if (validatedSteps.length === 0) {
      return ok(
        `Goal created: "${title}" (${domain}). No valid entries in plan_steps_json — goal saved without setup steps.`,
      );
    }

    const planId = await store.addPlan({
      goalId,
      title: `Plan for: ${title}`,
      steps: validatedSteps,
      scheduledFor: null,
    });
    const plan = useStore.getState().plans.find((p) => p.id === planId);
    if (!plan) {
      return ok('Goal created, but the plan could not be loaded to run steps.');
    }
    const exec = await executePlan(plan);
    return ok(
      `Goal created: "${title}" (${domain}). Ran ${exec.completed}/${validatedSteps.length} setup step(s).`,
    );
  },
};

const updateCommitment: Tool = {
  name: 'update_commitment',
  description: 'Update a coaching commitment response (adopted/skipped)',
  params: {
    id: { type: 'string', required: true, description: 'Commitment ID' },
    adopted: { type: 'number', required: true, description: '1 if adopted, 0 if skipped' },
    outcome: { type: 'string', required: false, description: 'User feedback' },
  },
  execute: async (params) => {
    const { getDatabase } = await import('../db/database');
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE coaching_commitments SET adopted = ?, outcome = ? WHERE id = ?',
      [params.adopted as number, (params.outcome as string) || null, params.id as string],
    );
    return ok('Thanks for the feedback! This helps me coach better.');
  },
};

export const toolRegistry: Map<string, Tool> = new Map([
  [addTask.name, addTask],
  [completeTask.name, completeTask],
  [deleteTask.name, deleteTask],
  [logHydration.name, logHydration],
  [setFocusMode.name, setFocusMode],
  [sendSnippet.name, sendSnippet],
  [queryStatus.name, queryStatus],
  [queryTasks.name, queryTasks],
  [queryHydration.name, queryHydration],
  [queryCalendar.name, queryCalendar],
  [createEvent.name, createEvent],
  [queryEmails.name, queryEmails],
  [triageEmails.name, triageEmails],
  [extractTasksFromEmailTool.name, extractTasksFromEmailTool],
  [setHydrationReminderTool.name, setHydrationReminderTool],
  [disableHydrationReminderTool.name, disableHydrationReminderTool],
  [createApiKeyTool.name, createApiKeyTool],
  [listApiKeysTool.name, listApiKeysTool],
  [revokeApiKeyTool.name, revokeApiKeyTool],
  [logSleep.name, logSleep],
  [querySleep.name, querySleep],
  [updateSetting.name, updateSetting],
  [scheduleReminder.name, scheduleReminder],
  [createAutomationRuleTool.name, createAutomationRuleTool],
  [showWebhookInfo.name, showWebhookInfo],
  [addHabit.name, addHabit],
  [logHabitTool.name, logHabitTool],
  [deleteHabitTool.name, deleteHabitTool],
  [queryMemories.name, queryMemories],
  [deleteMemory.name, deleteMemory],
  [logMood.name, logMood],
  [queryMood.name, queryMood],
  [addNoteTool.name, addNoteTool],
  [queryNotes.name, queryNotes],
  [triageInbox.name, triageInbox],
  [createTimeBlock.name, createTimeBlock],
  [queryTimeBlocks.name, queryTimeBlocks],
  [logExpense.name, logExpense],
  [queryExpenses.name, queryExpenses],
  [setBudgetTool.name, setBudgetTool],
  [createGoalTool.name, createGoalTool],
  [updateCommitment.name, updateCommitment],
]);

export function getTool(name: string): Tool | undefined {
  return toolRegistry.get(name);
}

// ── Parameter validation + hallucination fixing ───

/** Common parameter name hallucinations by LLMs and their correct mappings per tool. */
const PARAM_ALIASES: Record<string, Record<string, string>> = {
  log_hydration: { amount: 'amount_ml', ml: 'amount_ml', water: 'amount_ml', quantity: 'amount_ml' },
  add_task: { name: 'title', text: 'title', task: 'title', description: 'notes', date: 'dueDate', due: 'dueDate' },
  complete_task: { title: 'title_match', name: 'title_match', task: 'title_match' },
  delete_task: { title: 'title_match', name: 'title_match', task: 'title_match' },
  set_focus_mode: { time: 'durationMin', duration: 'durationMin', minutes: 'durationMin', on: 'enabled', off: 'enabled' },
  log_sleep: { start: 'action', end: 'action' },
  log_mood: { level: 'mood', score: 'mood', energy_level: 'energy' },
  log_expense: { cost: 'amount', price: 'amount', spent: 'amount', type: 'category', desc: 'description', note: 'description' },
  schedule_reminder: { message: 'text', when: 'text', at: 'text' },
  add_note: { content: 'body', text: 'body', name: 'title' },
  add_habit: { title: 'name', habit: 'name', target: 'target_per_day' },
  log_habit: { name: 'name_match', habit: 'name_match', habit_name: 'name_match' },
};

/**
 * Validate and fix tool parameters before execution.
 * 1. Apply alias mappings (fix hallucinated param names)
 * 2. Coerce types (string "500" → number 500)
 * 3. Check required params are present
 */
export function validateAndFixParams(toolName: string, tool: Tool, rawParams: Record<string, unknown>): { params: Record<string, unknown>; error?: string } {
  const fixed: Record<string, unknown> = {};
  const aliases = PARAM_ALIASES[toolName] ?? {};

  // Step 1: Map aliased param names to correct names
  for (const [key, value] of Object.entries(rawParams)) {
    const correctName = aliases[key] ?? key;
    fixed[correctName] = value;
  }

  // Step 2: Type coercion based on schema
  for (const [name, schema] of Object.entries(tool.params)) {
    if (fixed[name] === undefined) continue;

    if (schema.type === 'number' && typeof fixed[name] === 'string') {
      const num = Number(fixed[name]);
      if (!isNaN(num)) fixed[name] = num;
    }
    if (schema.type === 'boolean' && typeof fixed[name] === 'string') {
      const s = (fixed[name] as string).toLowerCase();
      fixed[name] = s === 'true' || s === 'yes' || s === 'on' || s === '1';
    }
  }

  // Step 3: Check required params
  for (const [name, schema] of Object.entries(tool.params)) {
    if (schema.required && (fixed[name] === undefined || fixed[name] === null || fixed[name] === '')) {
      return { params: fixed, error: `Missing required parameter "${name}" for ${toolName}. Expected: ${schema.description ?? schema.type}` };
    }
  }

  return { params: fixed };
}

/** Validate an arbitrary plan step against tool schema. */
export function validatePlanStep(
  step: { tool: string; params: Record<string, unknown> },
): { ok: boolean; params?: Record<string, unknown>; error?: string } {
  const tool = toolRegistry.get(step.tool);
  if (!tool) return { ok: false, error: `Unknown tool: ${step.tool}` };
  const out = validateAndFixParams(step.tool, tool, step.params ?? {});
  if (out.error) return { ok: false, error: out.error };
  return { ok: true, params: out.params };
}

/**
 * Execute a tool with validation, alias fixing, and goal progress enrichment.
 * Use this instead of raw tool.execute() for user-facing tool calls.
 */
export async function executeToolWithGoalContext(
  toolName: string,
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = toolRegistry.get(toolName);
  if (!tool) return fail(`Unknown tool: ${toolName}`);

  // Validate and fix parameters
  const { params: fixedParams, error } = validateAndFixParams(toolName, tool, params);
  if (error) return fail(error);

  try {
    const result = await withTimeout(tool.execute(fixedParams), 10_000, toolName);
    return enrichWithGoalProgress(toolName, result);
  } catch (e: any) {
    if (e?.message?.includes('timed out')) {
      return fail(`Tool ${toolName} timed out after 10s. Try again or simplify your request.`);
    }
    return fail(e?.message ?? `Tool ${toolName} failed unexpectedly.`);
  }
}
