// PicoClaw Agent — input tokenizer + fact extraction
// Converts raw user text into structured facts for the rules engine

import type { InputFacts } from './types';

const KW_HYDRATION = ['water', 'drink', 'hydrat', 'ml', 'glass', 'cup', 'sip'];
const KW_TASK = ['task', 'todo', 'remind', 'reminder', 'errand', 'chore'];
const KW_FOCUS = ['focus', 'concentrate', 'deep work', 'pomodoro', 'distract'];
const KW_PARTNER = ['partner', 'send', 'message', 'snippet', 'chat', 'tell partner', 'say to'];
const KW_SLEEP = ['sleep', 'nap', 'rest', 'bed', 'wake', 'asleep'];
const KW_STATUS = ['status', 'summary', 'how much', 'how many', 'overview', 'progress', 'dashboard'];
const KW_COMPLETE = ['done', 'complete', 'finish', 'check off', 'mark done', 'finished'];
const KW_DELETE = ['delete', 'remove', 'cancel', 'discard', 'trash'];
const KW_ENABLE = ['start', 'enable', 'begin', 'on', 'activate', 'turn on', 'launch'];
const KW_DISABLE = ['stop', 'disable', 'end', 'off', 'deactivate', 'turn off', 'quit'];
const KW_ROUTINE = ['routine', 'morning', 'night', 'daily', 'evening', 'bedtime'];
const KW_QUERY = ['show', 'list', 'what', 'how', 'get', 'view', 'display', 'tell'];
const KW_CALENDAR = ['calendar', 'event', 'meeting', 'schedule', 'appointment', 'agenda', 'busy'];
const KW_EMAIL = ['email', 'mail', 'inbox', 'unread', 'gmail', 'triage'];
const KW_TRIAGE = ['triage', 'categorize', 'sort', 'classify', 'prioritize'];
const KW_EXTRACT = ['extract', 'find action', 'action item', 'pull task', 'tasks from'];
const KW_APIKEY = ['api key', 'apikey', 'api-key', 'integration', 'external', 'tasker'];
const KW_SCHEDULE = ['schedule', 'every', 'interval', 'from', 'between', 'range', 'remind', 'alarm', 'alert'];
const KW_LOG = ['log', 'record', 'logged', 'track', 'tracking'];
const KW_SETTINGS = ['setting', 'configure', 'change goal', 'adjust', 'set goal', 'set default'];
const KW_AUTOMATION = ['rule', 'automate', 'automation', 'whenever', 'create rule'];
const KW_WEBHOOK = ['webhook', 'connect tasker', 'setup integration', 'api setup'];

function matchesAny(lower: string, keywords: string[]): boolean {
  return keywords.some(kw => lower.includes(kw));
}

/** Extract amount in ml from text like "500ml", "500 ml", "2 glasses", "3 cups" */
function extractAmountMl(text: string): number | null {
  // Direct ml: "500ml", "500 ml"
  const mlMatch = text.match(/(\d+)\s*ml\b/i);
  if (mlMatch) return parseInt(mlMatch[1]);

  // Glasses: "2 glasses" → 250ml each
  const glassMatch = text.match(/(\d+)\s*glass(?:es)?\b/i);
  if (glassMatch) return parseInt(glassMatch[1]) * 250;

  // Cups: "3 cups" → 250ml each
  const cupMatch = text.match(/(\d+)\s*cups?\b/i);
  if (cupMatch) return parseInt(cupMatch[1]) * 250;

  // Liters: "1.5 liters", "2l"
  const literMatch = text.match(/([\d.]+)\s*(?:liters?|l)\b/i);
  if (literMatch) return Math.round(parseFloat(literMatch[1]) * 1000);

  return null;
}

/** Extract duration in minutes from text like "45 minutes", "1 hour", "1.5h" */
function extractDurationMin(text: string): number | null {
  const minMatch = text.match(/(\d+)\s*(?:min(?:ute)?s?|m)\b/i);
  if (minMatch) return parseInt(minMatch[1]);

  const hourMatch = text.match(/([\d.]+)\s*(?:hours?|h)\b/i);
  if (hourMatch) return Math.round(parseFloat(hourMatch[1]) * 60);

  return null;
}

/** Extract priority from text */
function extractPriority(text: string): 'low' | 'medium' | 'high' | null {
  const lower = text.toLowerCase();
  if (/\bhigh\s*(?:priority|prio)?\b/.test(lower) || lower.includes('urgent') || lower.includes('important')) return 'high';
  if (/\blow\s*(?:priority|prio)?\b/.test(lower)) return 'low';
  if (/\bmedium\s*(?:priority|prio)?\b/.test(lower) || /\bnormal\s*(?:priority|prio)?\b/.test(lower)) return 'medium';
  return null;
}

/** Extract all numbers from text */
function extractNumbers(text: string): number[] {
  const matches = text.match(/\d+(?:\.\d+)?/g);
  return matches ? matches.map(Number) : [];
}

/** Extract recurrence pattern: "every Monday", "daily", "weekly", "every weekday" */
function extractRecurrence(text: string): string | null {
  const patterns = [
    /every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
    /every\s+weekday/i,
    /every\s+day\b/i,
    /\bdaily\b/i,
    /\bweekly\b/i,
    /every\s+(\d+)\s+(?:hours?|days?|weeks?)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

/** Extract reminder text from "remind me to X" */
function extractReminderText(text: string): string | null {
  const m = text.match(/remind\s+me\s+to\s+(.+?)(?:\s+(?:at|on|in|tomorrow)\s+|$)/i);
  return m ? m[1].trim() : null;
}

/** Extract sleep time from text: "at 11pm", "at 6:30am" */
function extractSleepTime(text: string): string | null {
  const m = text.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  return m ? m[0].trim() : null;
}

/** Main fact extractor — converts raw input to structured facts */
export function extractFacts(input: string): InputFacts {
  const raw = input;
  const lower = input.toLowerCase();
  const tokens = lower.split(/\s+/).filter(Boolean);

  return {
    raw,
    lower,
    tokens,
    numbers: extractNumbers(input),
    has_amount_ml: extractAmountMl(input),
    has_duration_min: extractDurationMin(input),
    has_priority: extractPriority(input),
    has_date: null, // TODO: date parsing (dayjs or chrono-node)

    kw_hydration: matchesAny(lower, KW_HYDRATION),
    kw_task: matchesAny(lower, KW_TASK),
    kw_focus: matchesAny(lower, KW_FOCUS),
    kw_partner: matchesAny(lower, KW_PARTNER),
    kw_sleep: matchesAny(lower, KW_SLEEP),
    kw_status: matchesAny(lower, KW_STATUS),
    kw_complete: matchesAny(lower, KW_COMPLETE),
    kw_delete: matchesAny(lower, KW_DELETE),
    kw_enable: matchesAny(lower, KW_ENABLE),
    kw_disable: matchesAny(lower, KW_DISABLE),
    kw_routine: matchesAny(lower, KW_ROUTINE),
    kw_query: matchesAny(lower, KW_QUERY),
    kw_log: matchesAny(lower, KW_LOG),

    kw_calendar: matchesAny(lower, KW_CALENDAR),
    kw_email: matchesAny(lower, KW_EMAIL),
    kw_triage: matchesAny(lower, KW_TRIAGE),
    kw_extract: matchesAny(lower, KW_EXTRACT),

    kw_apikey: matchesAny(lower, KW_APIKEY),

    kw_schedule: matchesAny(lower, KW_SCHEDULE),
    has_time_range: extractTimeRange(input),
    has_goal_liters: extractGoalLiters(input),

    // Sleep logging
    has_sleep_time: extractSleepTime(input),

    // Reminders
    kw_remind: lower.includes('remind me') || lower.includes('alert me') || lower.includes('notify me'),
    has_reminder_text: extractReminderText(input),

    // Settings
    kw_settings: matchesAny(lower, KW_SETTINGS),

    // Recurring tasks
    has_recurrence: extractRecurrence(input),

    // Automation
    kw_automation: matchesAny(lower, KW_AUTOMATION),

    // Webhook info
    kw_webhook: matchesAny(lower, KW_WEBHOOK),
  };
}

/** Extract a task title by stripping command prefixes */
export function extractTaskTitle(input: string): string {
  return input
    .replace(/^(add|create|new|make|set|remind(?:\s+me)?(?:\s+to)?)\s+(a\s+)?(?:task|todo|reminder)\s*/i, '')
    .replace(/\s+(high|low|medium|normal)\s*(?:priority|prio)?\s*$/i, '')
    .trim() || input;
}

/** Extract snippet/message content by stripping command prefixes */
export function extractSnippetContent(input: string): string {
  return input
    .replace(/^(send|message|tell)\s+(a\s+)?(?:snippet|message)?\s*(?:to\s+\w+\s*)?/i, '')
    .replace(/^say\s+to\s+partner\s*/i, '')
    .replace(/^tell\s+partner\s*/i, '')
    .trim() || input;
}

/** Extract time range like "from 8am to 10pm", "8am-10pm", "between 8 and 22" */
export function extractTimeRange(input: string): { startHour: number; endHour: number } | null {
  const rangeMatch = input.match(
    /(?:from\s+)?(\d{1,2})\s*(am|pm)?\s*(?:to|-)\s*(\d{1,2})\s*(am|pm)?/i
  );
  if (rangeMatch) {
    let start = parseInt(rangeMatch[1]);
    let end = parseInt(rangeMatch[3]);
    const startAmPm = rangeMatch[2]?.toLowerCase();
    const endAmPm = rangeMatch[4]?.toLowerCase();
    if (startAmPm === 'pm' && start < 12) start += 12;
    if (startAmPm === 'am' && start === 12) start = 0;
    if (endAmPm === 'pm' && end < 12) end += 12;
    if (endAmPm === 'am' && end === 12) end = 0;
    if (start !== end && start < end) return { startHour: start, endHour: end };
  }
  return null;
}

/** Extract goal in liters: "2.5 liters", "2.5l", "3 litres" */
export function extractGoalLiters(input: string): number | null {
  const match = input.match(/([\d.]+)\s*(?:liters?|litres?|l)\b/i);
  if (match) return parseFloat(match[1]);
  return null;
}

/** Extract event summary from natural language like "schedule meeting with Bob" */
export function extractEventSummary(input: string): string {
  return input
    .replace(/^(schedule|create|add|new|set)\s+(a\s+|an\s+)?(?:event|meeting|appointment|calendar)\s*/i, '')
    .replace(/\s+(?:at|on|from|for)\s+\d.*/i, '')
    .trim() || input;
}

/** Extract time from text like "at 3pm", "at 15:00", "tomorrow 10am" */
export function extractTimeFromText(input: string): { hour: number; minute: number } | null {
  // "at 3pm", "at 3:30pm"
  const timeMatch = input.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1]);
    const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const ampm = timeMatch[3].toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    return { hour, minute };
  }

  // "at 15:00"
  const h24Match = input.match(/(?:at\s+)?(\d{1,2}):(\d{2})(?!\s*(?:am|pm))/i);
  if (h24Match) {
    return { hour: parseInt(h24Match[1]), minute: parseInt(h24Match[2]) };
  }

  return null;
}
