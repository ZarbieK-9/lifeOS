// PicoClaw Agent — Context Gatherer
// Reads current app state from the Zustand store and serializes it for the on-device LLM.
// Smart: only syncs/includes Google data when the input needs it.
//
// Context budget (maxChars): when over limit we first compress (e.g. top 5 tasks), then
// drop sections in canonical priority order (least important first):
//   conversation_history → expenses → notes → mood → memory → relevant → emails → calendar → tasks

import { useStore } from '../store/useStore';
import { searchRelevantContext, extractKeywords } from '../db/search';
import { getPatternSummary } from './patterns';
import dayjs from 'dayjs';

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const REMEMBER_PATTERN = /\[REMEMBER:\s*(.+?)\]/g;
const DEFAULT_TOP_K = 6;

/** Max conversation history: 6 turns when full context, 3 for normal, 1–2 when on char budget. */
const MAX_HISTORY_TURNS_FULL = 6;
const MAX_HISTORY_TURNS_NORMAL = 3;
const MAX_HISTORY_CHARS = 2000; // strip oldest turns if total exceeds this

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
export async function gatherContext(needs?: ContextNeeds, maxChars?: number, userInput?: string, chatId?: string | null): Promise<string> {
  const tag = '[gatherContext]';
  console.time(`${tag} total`);
  const s = useStore.getState();

  const n = needs ?? { calendar: true, emails: true, tasks: true, notes: true, mood: true, expenses: true, full: true };
  const inputKeywords = extractKeywords(userInput ?? '').split(/\s+/).filter(Boolean);
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

  const up = state.userProfile;
  if (up && (n.full || n.tasks || n.calendar)) {
    context.day_profile = {
      outline: up.day_outline ?? null,
      activity_prefs: up.activity_prefs ?? null,
      typical_wake_time: up.typical_wake_time ?? null,
      leave_home_time: up.leave_home_time ?? null,
      work_start_time: up.work_start_time ?? null,
      typical_bedtime: up.typical_bedtime ?? null,
      coach_enabled: up.day_coach_enabled !== 0,
      weight_goal: up.goal_type && up.target_weight_kg != null
        ? { type: up.goal_type, target_kg: up.target_weight_kg }
        : null,
    };
  }
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
    if (Array.isArray((context.tasks as any).pending)) {
      (context.tasks as any).pending = topKByScore(
        (context.tasks as any).pending,
        DEFAULT_TOP_K,
        inputKeywords,
        (t) => `${t.title ?? ''} ${t.recurrence ?? ''}`,
        (t) => t.due_date ?? null,
      );
    }
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
    if (Array.isArray(context.calendar)) {
      context.calendar = topKByScore(
        context.calendar as any[],
        DEFAULT_TOP_K,
        inputKeywords,
        (e) => `${e.summary ?? ''} ${e.location ?? ''}`,
        (e) => e.start_time ?? null,
      );
    }
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
    if (Array.isArray((context.emails as any).important)) {
      (context.emails as any).important = topKByScore(
        (context.emails as any).important,
        DEFAULT_TOP_K,
        inputKeywords,
        (e) => `${e.subject ?? ''} ${e.snippet ?? ''} ${e.category ?? ''}`,
        () => null,
      );
    }
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
    if (Array.isArray((context.notes as any).recent)) {
      (context.notes as any).recent = topKByScore(
        (context.notes as any).recent,
        4,
        inputKeywords,
        (note) => `${note.title ?? ''} ${note.preview ?? ''} ${note.category ?? ''}`,
        (note) => note.updated_at ?? null,
      );
    }
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
  if (state.locationContextEnabled && state.lastKnownLocation) {
    context.location = {
      lat: state.lastKnownLocation.lat,
      lng: state.lastKnownLocation.lng,
      observed_at: state.lastKnownLocation.ts,
      places: state.geofencePlaces.slice(0, 8).map((p) => ({
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        radius_m: p.radius_m,
      })),
    };
  }

  // Memory — always include (lightweight)
  const facts = state.getMemoryFacts();
  if (facts.length > 0) {
    context.memory = facts.slice(0, 20);
  }

  // Active goals — always include (lightweight, high-value context)
  const activeGoals = state.goals.filter(g => g.status === 'active');
  if (activeGoals.length > 0) {
    context.goals = activeGoals.slice(0, 10).map(g => ({
      title: g.title,
      domain: g.domain,
      progress: g.targetValue ? `${Math.round((g.currentValue / g.targetValue) * 100)}%` : null,
      target: g.targetValue ? `${g.targetValue} ${g.unit ?? ''}`.trim() : null,
      deadline: g.deadline,
    }));
  }

  // Learned patterns — human-readable summary for the LLM to reference
  const patternSummary = getPatternSummary();
  if (patternSummary) {
    context.learned_patterns = patternSummary;
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

  // Conversation history — capped by turns and total chars (see MAX_HISTORY_*)
  const historyLimit = maxChars ? (maxChars < 2000 ? 1 : 2) : (n.full ? MAX_HISTORY_TURNS_FULL : MAX_HISTORY_TURNS_NORMAL);
  const outputLimit = maxChars ? 200 : 500;
  let recentCommands = state.aiCommands
    .filter(c => c.status === 'executed' && c.output && (!chatId || c.chat_id === chatId))
    .slice(0, historyLimit)
    .reverse();

  if (recentCommands.length > 0) {
    let entries = recentCommands.map(c => ({
      role: c.source === 'user' ? 'user' as const : 'assistant' as const,
      input: c.source === 'user' ? c.input : (proactiveLabelForContext(c.source) || c.input),
      output: cleanOutputForContext(c.output!, outputLimit),
      time: c.created_at,
    }));
    // Strip oldest turns if total length exceeds MAX_HISTORY_CHARS
    let totalChars = entries.reduce((sum, e) => sum + (e.input?.length ?? 0) + (e.output?.length ?? 0), 0);
    while (entries.length > 1 && totalChars > MAX_HISTORY_CHARS) {
      const removed = entries.pop()!;
      totalChars -= (removed.input?.length ?? 0) + (removed.output?.length ?? 0);
    }
    context.conversation_history = entries;
  }

  // Build context preamble so LLM knows what data it has
  const summaryParts: string[] = [];
  const pendingCount = (context.tasks as any)?.pending?.length ?? (context.tasks as any)?.pending_count ?? 0;
  if (pendingCount > 0) summaryParts.push(`${pendingCount} tasks`);
  if ((context.calendar as any[])?.length) summaryParts.push(`${(context.calendar as any[]).length} events`);
  if ((context.goals as any[])?.length) summaryParts.push(`${(context.goals as any[]).length} goals`);
  if ((context.patterns as any[])?.length) summaryParts.push(`${(context.patterns as any[]).length} patterns`);
  if ((context.memory as any[])?.length) summaryParts.push(`${(context.memory as any[]).length} memories`);
  if ((context.emails as any)?.unread_count) summaryParts.push(`${(context.emails as any).unread_count} unread emails`);
  if (summaryParts.length > 0) {
    context._summary = `Data available: ${summaryParts.join(', ')}`;
  }

  let json = JSON.stringify(context);
  console.log(`${tag} context size: ${json.length} chars (calendar=${n.calendar}, emails=${n.emails}, tasks=${n.tasks})`);

  // ── Budget enforcement: compress → drop sections (canonical priority) ──
  if (maxChars && json.length > maxChars) {
    // Phase 1: Gradual compression — shrink sections before dropping them
    const compressions: Array<{ key: string; compress: () => void }> = [
      {
        key: 'conversation_history',
        compress: () => {
          if (Array.isArray(context.conversation_history) && (context.conversation_history as unknown[]).length > 3) {
            (context as any).conversation_history = (context.conversation_history as unknown[]).slice(-3);
          }
        },
      },
      {
        key: 'tasks',
        compress: () => {
          const t = context.tasks as { pending?: unknown[] } | undefined;
          if (t?.pending && Array.isArray(t.pending) && t.pending.length > 5) {
            t.pending = t.pending.slice(0, 5);
          }
        },
      },
      {
        key: 'calendar',
        compress: () => {
          if (Array.isArray(context.calendar) && (context.calendar as any[]).length > 5) {
            const todayStr = dayjs().format('YYYY-MM-DD');
            (context as any).calendar = (context.calendar as any[])
              .filter((e: any) => e.start_time?.startsWith?.(todayStr))
              .slice(0, 5);
          }
        },
      },
      {
        key: 'notes',
        compress: () => {
          const n2 = context.notes as { recent?: unknown[] } | undefined;
          if (n2?.recent && Array.isArray(n2.recent) && n2.recent.length > 3) {
            n2.recent = n2.recent.slice(0, 3);
          }
        },
      },
      {
        key: 'emails',
        compress: () => {
          const e2 = context.emails as { important?: unknown[] } | undefined;
          if (e2?.important && Array.isArray(e2.important) && e2.important.length > 3) {
            e2.important = e2.important.slice(0, 3);
          }
        },
      },
    ];
    for (const c of compressions) {
      if (json.length <= maxChars) break;
      if ((context as any)[c.key] !== undefined) {
        c.compress();
        json = JSON.stringify(context);
        console.log(`${tag} budget: compressed '${c.key}', now ${json.length} chars`);
      }
    }
    if (json.length <= maxChars) {
      console.timeEnd(`${tag} total`);
      return json;
    }

    // Phase 2: Drop entire sections in canonical priority order
    const dropOrder: (keyof typeof context)[] = [
      'conversation_history', // drop history first — most tokens
      '_summary',             // preamble is nice but expendable
      'expenses',
      'notes',
      'mood',
      'memory',
      'relevant',             // RAG results
      'emails',
      'calendar',
      'learned_patterns',     // patterns improve tool selection — keep late
      'goals',                // goals are highest-value context — drop very late
      'tasks',                // tasks almost never dropped
    ];
    for (const key of dropOrder) {
      if (json.length <= maxChars) break;
      if (context[key] !== undefined) {
        delete context[key];
        json = JSON.stringify(context);
        console.log(`${tag} budget: dropped '${key}', now ${json.length} chars`);
      }
    }
    // Final safety: return minimal structured context (never hard-truncate JSON).
    if (json.length > maxChars) {
      const minimalContext = {
        now: context.now,
        hydration: context.hydration,
        focus: context.focus,
        sleep: context.sleep,
        tasks: { pending_count: state.tasks.filter(t => t.status === 'pending').length },
        _summary: 'Minimal context mode',
      };
      json = JSON.stringify(minimalContext);
      if (json.length > maxChars) {
        // Keep valid JSON while honoring strict budget.
        json = JSON.stringify({
          now: context.now,
          tasks: { pending_count: state.tasks.filter(t => t.status === 'pending').length },
        });
      }
      console.log(`${tag} budget: reduced to minimal structured context (${json.length} chars)`);
    }
  }

  // Native LLM can fail with very small input (e.g. "Exception in HostFunction") — enforce minimum
  const MIN_CONTEXT_CHARS = 600;
  if (json.length > 0 && json.length < MIN_CONTEXT_CHARS) {
    const need = Math.max(0, MIN_CONTEXT_CHARS - json.length - 12);
    (context as Record<string, unknown>)._pad = 'Respond briefly. ' + ' '.repeat(need);
    json = JSON.stringify(context);
    console.log(`${tag} budget: padded to ${json.length} chars minimum`);
  }

  if (n.emails && state.emails?.length) {
    console.log(`${tag} emails in context: ${state.emails.slice(0, 5).map((e) => e.subject || e.snippet?.slice(0, 40)).join(' | ')}`);
  }
  console.timeEnd(`${tag} total`);
  return json;
}

function topKByScore<T>(
  items: T[],
  k: number,
  keywords: string[],
  textOf: (item: T) => string,
  dateOf: (item: T) => string | null,
): T[] {
  if (items.length <= k) return items;
  const now = Date.now();
  const scored = items.map((item) => {
    const text = textOf(item).toLowerCase();
    const matchCount = keywords.reduce((acc, kw) => (kw && text.includes(kw.toLowerCase()) ? acc + 1 : acc), 0);
    const date = dateOf(item);
    const ageDays = date ? Math.max(0, (now - new Date(date).getTime()) / (1000 * 60 * 60 * 24)) : 10;
    const recency = Math.max(0, 3 - ageDays * 0.25);
    const trust = 1; // placeholder trust prior; can be learned later.
    return { item, score: matchCount * 2 + recency + trust };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((x) => x.item);
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
