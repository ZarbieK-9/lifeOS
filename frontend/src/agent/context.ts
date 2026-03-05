// PicoClaw Agent — Context Gatherer
// Reads current app state from the Zustand store and serializes it
// for the backend to include in the Gemini prompt.
// Smart: only syncs/includes Google data when the input needs it.

import { useStore } from '../store/useStore';
import { searchRelevantContext, extractKeywords } from '../db/search';
import dayjs from 'dayjs';

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const REMEMBER_PATTERN = /\[REMEMBER:\s*(.+?)\]/g;

// ── Context needs detection ──────────────────────────

export interface ContextNeeds {
  calendar: boolean;
  emails: boolean;
  tasks: boolean;
  notes: boolean;
  mood: boolean;
  expenses: boolean;
  /** Full context — proactive messages, "plan my day", etc. */
  full: boolean;
}

const CALENDAR_KEYWORDS = /\b(calendar|schedule|meeting|event|appointment|today|tomorrow|plan\s+my\s+day|morning|afternoon|busy|free|when|organize)\b/i;
const EMAIL_KEYWORDS = /\b(emails?|mail|mails|inbox|unread|message|gmail|send|reply|respond)\b/i;
const TASK_KEYWORDS = /\b(task|todo|to-?do|list|pending|complete|done|plan|remind|add\s+task|finish)\b/i;
const NOTE_KEYWORDS = /\b(notes?|journal|wrote|entry|write|diary|log\s+thought)\b/i;
const MOOD_KEYWORDS = /\b(mood|energy|feeling|feel|stress|happy|sad|tired|anxious|emotion)\b/i;
const EXPENSE_KEYWORDS = /\b(expense|spent|spend|cost|budget|money|price|pay|paid|dollar|purchase)\b/i;
const SYSTEM_PREFIX = /^\[SYSTEM:/;

export function detectContextNeeds(input: string): ContextNeeds {
  // Proactive/system messages always get full context
  if (SYSTEM_PREFIX.test(input)) {
    return { calendar: true, emails: true, tasks: true, notes: true, mood: true, expenses: true, full: true };
  }

  return {
    calendar: CALENDAR_KEYWORDS.test(input),
    emails: EMAIL_KEYWORDS.test(input),
    tasks: TASK_KEYWORDS.test(input),
    notes: NOTE_KEYWORDS.test(input),
    mood: MOOD_KEYWORDS.test(input),
    expenses: EXPENSE_KEYWORDS.test(input),
    full: false,
  };
}

/**
 * Gather current app context and serialize to JSON.
 * Only syncs and includes Google data when `needs` indicates it.
 * Includes recent conversation history for multi-turn context.
 *
 * @param needs — which sections to include (auto-detected from input)
 * @param maxChars — optional character budget. When set, progressively drops
 *   low-priority sections to stay within budget. Used for on-device models
 *   with small context windows.
 * @param userInput — original user input for FTS5 RAG search (offline only)
 */
export async function gatherContext(needs?: ContextNeeds, maxChars?: number, userInput?: string): Promise<string> {
  const tag = '[gatherContext]';
  console.time(`${tag} total`);
  const s = useStore.getState();

  const n = needs ?? { calendar: true, emails: true, tasks: true, notes: true, mood: true, expenses: true, full: true };
  const wantGoogle = (n.calendar || n.emails) && s.isGoogleConnected;

  // Sync Google data if needed and stale
  if (wantGoogle) {
    const now = Date.now();
    const calAge = s.calendarLastSynced ? now - new Date(s.calendarLastSynced).getTime() : Infinity;
    const emailAge = s.emailLastSynced ? now - new Date(s.emailLastSynced).getTime() : Infinity;
    console.log(`${tag} Google sync needed. Calendar age: ${Math.round(calAge / 1000)}s, Email age: ${Math.round(emailAge / 1000)}s`);

    if (n.calendar && calAge > STALE_THRESHOLD_MS) {
      console.time(`${tag} syncCalendar`);
      try { await s.syncCalendarEvents(); } catch { /* ignore sync errors */ }
      console.timeEnd(`${tag} syncCalendar`);
    }
    if (n.emails && emailAge > STALE_THRESHOLD_MS) {
      console.time(`${tag} syncEmails`);
      try { await s.syncEmails(); } catch { /* ignore sync errors */ }
      console.timeEnd(`${tag} syncEmails`);
    }
  } else {
    console.log(`${tag} skipping Google sync (not needed or not connected)`);
  }

  // Re-read after potential sync
  const state = useStore.getState();

  // ── Build context object — only include what's needed ──

  const context: Record<string, unknown> = {
    now: new Date().toISOString(),
  };

  // Always include basic status
  context.hydration = {
    today_ml: state.hydrationTodayMl,
    goal_ml: state.hydrationGoalMl || 2500,
  };
  context.focus = {
    enabled: state.focusEnabled,
    remaining_min: state.focusRemainingMin,
  };
  context.sleep = {
    is_tracking: state.sleep.isAsleep,
    last_duration_min: state.sleep.durationMinutes || null,
  };

  // Tasks — include when needed or for full context
  if (n.tasks || n.full) {
    const pendingTasks = state.tasks.filter(t => t.status === 'pending');
    const completedToday = state.tasks.filter(
      t => t.status === 'completed' && dayjs(t.updated_at).isSame(dayjs(), 'day')
    ).length;
    context.tasks = {
      pending: pendingTasks.slice(0, 20).map(t => ({
        title: t.title,
        priority: t.priority,
        due_date: t.due_date,
        recurrence: t.recurrence,
      })),
      completed_today: completedToday,
    };
  } else {
    // Just counts for lightweight context
    context.tasks = {
      pending_count: state.tasks.filter(t => t.status === 'pending').length,
    };
  }

  // Calendar — only when relevant
  if (n.calendar && state.isGoogleConnected) {
    context.calendar = state.calendarEvents
      .filter(e => dayjs(e.start_time).isAfter(dayjs().startOf('day')))
      .slice(0, 15)
      .map(e => ({
        summary: e.summary,
        start_time: e.start_time,
        end_time: e.end_time,
        location: e.location,
        all_day: e.all_day,
      }));
  }

  // Emails — only when relevant
  if (n.emails && state.isGoogleConnected) {
    context.emails = {
      unread_count: state.unreadEmailCount,
      important: state.emails
        .filter(e => e.is_unread || e.category === 'important' || e.category === 'action_needed')
        .slice(0, 10)
        .map(e => ({
          from: e.from_address,
          subject: e.subject,
          snippet: e.snippet,
          category: e.category,
        })),
    };
  }

  // Notes — include when relevant
  if (n.notes || n.full) {
    context.notes = {
      count: state.notes.length,
      recent: state.notes.slice(0, 5).map(note => ({
        title: note.title,
        category: note.category,
        updated_at: note.updated_at,
        preview: note.body.slice(0, 80),
      })),
    };
  }

  // Mood — include when relevant
  if (n.mood || n.full) {
    const todayMood = state.moodLogs.find(l =>
      l.logged_at.startsWith(dayjs().format('YYYY-MM-DD'))
    );
    context.mood = {
      today: todayMood ? { mood: todayMood.mood, energy: todayMood.energy, note: todayMood.note } : null,
      recent: state.moodLogs.slice(0, 7).map(l => ({
        mood: l.mood,
        energy: l.energy,
        date: l.logged_at.split('T')[0],
      })),
    };
  }

  // Expenses — include when relevant
  if (n.expenses || n.full) {
    context.expenses = {
      today_total: state.todaySpend,
      month_total: state.monthSpend,
      recent: state.expenses.slice(0, 5).map(e => ({
        amount: e.amount,
        category: e.category,
        description: e.description,
        date: e.date,
      })),
    };
  }

  context.google_connected = state.isGoogleConnected;

  // Memory — always include (lightweight)
  const facts = state.getMemoryFacts();
  if (facts.length > 0) {
    context.memory = facts.slice(0, 20);
  }

  // FTS5 RAG — search for items relevant to user input (offline models only)
  // When maxChars is set, we're on a budget → use RAG to pull relevant items
  // instead of dumping all recent items.
  if (maxChars && userInput) {
    const keywords = extractKeywords(userInput);
    if (keywords) {
      try {
        const hits = await searchRelevantContext(keywords, 8);
        if (hits.length > 0) {
          context.relevant = hits.map(h => ({
            type: h.contentType,
            title: h.title,
            body: h.body.slice(0, 120),
            category: h.category,
          }));
          console.log(`${tag} RAG: ${hits.length} relevant items for "${keywords.slice(0, 40)}"`);
        }
      } catch {
        // FTS5 not available (first run, etc.) — skip gracefully
      }
    }
  }

  // Conversation history — capped to reduce token usage
  // When budget is tight (maxChars set), use fewer entries
  const historyLimit = maxChars ? (maxChars < 2000 ? 1 : 2) : (n.full ? 6 : 3);
  const outputLimit = maxChars ? 200 : 500;
  const recentCommands = state.aiCommands
    .filter(c => c.status === 'executed' && c.output)
    .slice(0, historyLimit)
    .reverse();

  if (recentCommands.length > 0) {
    context.conversation_history = recentCommands.map(c => ({
      role: c.source === 'user' ? 'user' as const : 'system' as const,
      input: c.source === 'user' ? c.input : (proactiveLabelForContext(c.source) || c.input),
      output: cleanOutputForContext(c.output!, outputLimit),
      time: c.created_at,
    }));
  }

  let json = JSON.stringify(context);
  console.log(`${tag} context size: ${json.length} chars (calendar=${n.calendar}, emails=${n.emails}, tasks=${n.tasks})`);

  // ── Budget enforcement: progressively drop sections if over limit ──
  if (maxChars && json.length > maxChars) {
    // Drop sections in priority order (least important first)
    const dropOrder: (keyof typeof context)[] = [
      'conversation_history', // drop history first — most tokens
      'expenses',
      'notes',
      'mood',
      'memory',
      'relevant', // RAG results — useful but expendable
      'emails',
      'calendar',
      'tasks',
    ];
    for (const key of dropOrder) {
      if (json.length <= maxChars) break;
      if (context[key] !== undefined) {
        delete context[key];
        json = JSON.stringify(context);
        console.log(`${tag} budget: dropped '${key}', now ${json.length} chars`);
      }
    }
    // Final safety: hard truncate if still over
    if (json.length > maxChars) {
      json = json.slice(0, maxChars);
      console.log(`${tag} budget: hard truncated to ${maxChars} chars`);
    }
  }

  if (n.emails && state.emails?.length) {
    console.log(`${tag} emails in context: ${state.emails.slice(0, 5).map((e) => e.subject || e.snippet?.slice(0, 40)).join(' | ')}`);
  }
  console.timeEnd(`${tag} total`);
  return json;
}

function proactiveLabelForContext(source: string): string | null {
  const labels: Record<string, string> = {
    morning: '[Morning Briefing]',
    checkin: '[Check-in]',
    evening: '[Evening Reflection]',
    calendar_alert: '[Calendar Alert]',
    calendar_gap: '[Free Time]',
    email_alert: '[Email Alert]',
    notification_alert: '[App Notification]',
  };
  return labels[source] ?? null;
}

function cleanOutputForContext(output: string, maxLen = 500): string {
  // Strip [REMEMBER:] tags and truncate long outputs
  const cleaned = output.replace(REMEMBER_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen - 3) + '...' : cleaned;
}
