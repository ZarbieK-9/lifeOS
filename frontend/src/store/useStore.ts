// Zustand store — CONTEXT.md: "zustand (offline-first state management)"
// Central app state. MMKV for sync reads, SQLite for persistence.

import { create } from 'zustand';
import dayjs from 'dayjs';
import { kv } from '../db/mmkv';
import { getDatabase, uid } from '../db/database';
import type { ModelStatus, DownloadProgress } from '../llm/types';

// ── FTS5 search index sync (fire-and-forget) ─────────
// Lazy import to avoid circular deps; errors are swallowed silently.
function ftsIndex(type: 'task' | 'note' | 'memory' | 'expense' | 'habit', id: string, title: string, body: string, category: string, date: string) {
  import('../db/search').then(m => m.indexItem(type, id, title, body, category, date)).catch(() => {});
}
function ftsRemove(id: string) {
  import('../db/search').then(m => m.removeFromIndex(id)).catch(() => {});
}

// ── Types ──────────────────────────────────────────

export interface Task {
  task_id: string;
  title: string;
  due_date: string | null;
  priority: 'low' | 'medium' | 'high';
  notes: string;
  status: 'pending' | 'completed' | 'overdue';
  recurrence: string | null;
  created_at: string;
  updated_at: string;
}

export interface HydrationLog {
  log_id: string;
  amount_ml: number;
  timestamp: string;
  synced: boolean;
}

export interface SleepState {
  isAsleep: boolean;
  sleepStart: string | null;
  sleepEnd: string | null;
  durationMinutes: number;
}

export interface QueuedEvent {
  id: string;
  type: string;
  payload: string;
  created_at: string;
  retry_count: number;
  status: string;
}

export interface Habit {
  id: string;
  name: string;
  icon: string;
  target_per_day: number;
  unit: string | null;
  enabled: boolean;
  created_at: string;
}

export interface HabitLog {
  id: string;
  habit_id: string;
  value: number;
  logged_at: string;
}

export interface ChatSession {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiCommand {
  id: string;
  chat_id: string | null;
  input: string;
  output: string | null;
  status: 'pending' | 'executed' | 'queued' | 'failed';
  source: 'user' | 'morning' | 'checkin' | 'evening' | 'calendar_alert' | 'calendar_gap' | 'email_alert' | 'notification_alert';
  created_at: string;
}

export interface AiMemory {
  id: string;
  fact: string;
  category: string;
  source_cmd_id: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface PartnerSnippet {
  snippet_id: string;
  partner_id: string;
  content: string;
  timestamp: string;
  synced: boolean;
}

export interface Partner {
  id: string;
  name: string;
  online: boolean;
  lastSeen: string;
}

export interface CalendarEvent {
  event_id: string;
  summary: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  all_day: boolean;
  status: string;
  html_link: string | null;
  google_calendar_id: string;
  synced_at: string;
}

export interface CachedEmail {
  message_id: string;
  thread_id: string;
  from_address: string;
  subject: string;
  snippet: string;
  date: string;
  is_unread: boolean;
  is_starred: boolean;
  label_ids: string[];
  category: 'important' | 'action_needed' | 'fyi' | 'newsletter' | null;
  extracted_tasks: string[];
}

export interface MoodLog {
  id: string;
  mood: number;       // 1-5
  energy: number;     // 1-5
  note: string | null;
  logged_at: string;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  category: 'note' | 'journal';
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface InboxItem {
  id: string;
  text: string;
  triaged: boolean;
  triage_result: string | null;
  created_at: string;
}

export interface TimeBlock {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  source: 'manual' | 'calendar' | 'ai';
  task_id: string | null;
  color: string;
  date: string;
  created_at: string;
}

export interface Expense {
  id: string;
  amount: number;
  currency: string;
  category: string;
  description: string | null;
  date: string;
  created_at: string;
}

export interface Budget {
  id: string;
  category: string;
  monthly_limit: number;
  currency: string;
  created_at: string;
}

// ── Agent types (re-exported for convenience) ──────
export type { Routine, AutomationRule, SleepSession, Reminder } from '../agent/types';

// ── Store ──────────────────────────────────────────

interface AppState {
  ready: boolean;
  isOnline: boolean;

  // Backend
  isBackendConfigured: boolean;
  isAuthenticated: boolean;

  // Sleep
  sleep: SleepState;

  // Hydration
  hydrationTodayMl: number;
  hydrationLogs: HydrationLog[];

  // Focus
  focusEnabled: boolean;
  focusStartedAt: string | null;
  focusDurationMin: number;
  focusRemainingMin: number;

  // Tasks
  tasks: Task[];

  // Sleep sessions
  sleepSessions: import('../agent/types').SleepSession[];

  // Reminders
  reminders: import('../agent/types').Reminder[];

  // Queue
  queueCount: number;
  queuedEvents: QueuedEvent[];

  // AI & Chat sessions
  chatSessions: ChatSession[];
  currentChatId: string | null;
  aiCommands: AiCommand[];
  aiMemories: AiMemory[];
  /** Always true — proactive AI is non-negotiable. */
  proactiveAIEnabled: true;
  /** Check-in interval in minutes (60, 90, 120). */
  checkinIntervalMin: number;
  /** No proactive (check-in etc.) after this hour (0-23). */
  proactiveQuietAfterHour: number;
  /** No proactive before this hour (0-23). */
  proactiveQuietBeforeHour: number;
  /** Always true on Android — notification listener is non-negotiable. */
  notificationListenerEnabled: boolean;
  seenNotifPackages: Array<{ packageName: string; appName: string }>;
  allowedNotifPackages: string[];

  // Partner
  partners: Partner[];
  partnerSnippets: PartnerSnippet[];

  // PicoClaw agent — routines & automation
  routines: import('../agent/types').Routine[];
  automationRules: import('../agent/types').AutomationRule[];

  // Auto sleep/wake routines
  autoMorningEnabled: boolean;
  autoNightEnabled: boolean;

  // Hydration reminders
  hydrationReminderEnabled: boolean;
  hydrationStartHour: number;
  hydrationEndHour: number;
  hydrationGoalMl: number;
  hydrationIntervalMin: number;
  nextHydrationReminderAt: string | null;
  hydrationDosePerReminder: number;
  hydrationSkippedMl: number;

  // Google integration
  isGoogleConnected: boolean;
  googleEmail: string | null;
  calendarEvents: CalendarEvent[];
  calendarSyncing: boolean;
  calendarLastSynced: string | null;
  lastCalendarError: string | null;
  emails: CachedEmail[];
  emailSyncing: boolean;
  emailLastSynced: string | null;
  lastEmailError: string | null;
  unreadEmailCount: number;

  // Streaks & daily score
  currentStreak: number;
  dailyScore: number;
  streakData: { date: string; score: number }[];
  scoreBreakdown: { hydration: number; tasks: number; sleep: number; habits: number };

  // Habits
  habits: Habit[];
  habitLogs: HabitLog[];

  // Mood & Energy
  moodLogs: MoodLog[];

  // Notes
  notes: Note[];

  // Inbox
  inboxItems: InboxItem[];

  // Time Blocks
  timeBlocks: TimeBlock[];

  // Expenses
  expenses: Expense[];
  budgets: Budget[];
  todaySpend: number;
  monthSpend: number;

  // Streak & Habit actions
  updateDailyStreak: () => Promise<void>;
  loadHabits: () => Promise<void>;
  addHabit: (name: string, icon?: string, targetPerDay?: number, unit?: string | null) => Promise<string>;
  logHabitEntry: (habitId: string, value?: number) => Promise<void>;
  deleteHabit: (habitId: string) => Promise<void>;
  getHabitStats: (habitId: string) => { currentStreak: number; bestStreak: number; weeklyCount: number; totalLogged: number; last30Days: { date: string; count: number }[] };

  // Mood actions
  loadMoodLogs: () => Promise<void>;
  addMoodLog: (mood: number, energy: number, note?: string) => Promise<void>;

  // Notes actions
  loadNotes: () => Promise<void>;
  addNote: (title: string, body?: string, category?: 'note' | 'journal') => Promise<string>;
  updateNote: (id: string, fields: Partial<Note>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;

  // Inbox actions
  loadInbox: () => Promise<void>;
  addInboxItem: (text: string) => Promise<void>;
  triageInboxItem: (id: string, result: string) => Promise<void>;
  deleteInboxItem: (id: string) => Promise<void>;

  // Time Block actions
  loadTimeBlocks: (date?: string) => Promise<void>;
  addTimeBlock: (title: string, startTime: string, endTime: string, date: string, source?: 'manual' | 'calendar' | 'ai', taskId?: string, color?: string) => Promise<void>;
  updateTimeBlock: (id: string, fields: Partial<TimeBlock>) => Promise<void>;
  deleteTimeBlock: (id: string) => Promise<void>;

  // Expense actions
  loadExpenses: () => Promise<void>;
  addExpense: (amount: number, category: string, description?: string, date?: string) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  loadBudgets: () => Promise<void>;
  setBudget: (category: string, monthlyLimit: number) => Promise<void>;

  // Actions
  init: () => Promise<void>;
  setOnline: (v: boolean) => void;
  setSleep: (s: Partial<SleepState>) => void;

  setBackendConfigured: (v: boolean) => void;
  setAuthenticated: (v: boolean) => void;

  logHydration: (ml: number) => Promise<void>;
  loadHydrationToday: () => Promise<void>;

  toggleFocus: (durationMin?: number) => void;
  tickFocus: () => void;

  // Auto sleep/wake routines
  setAutoMorning: (v: boolean) => void;
  setAutoNight: (v: boolean) => void;

  // Hydration reminders
  setHydrationReminder: (startHour: number, endHour: number, goalMl: number, intervalMin?: number) => void;
  disableHydrationReminder: () => void;
  skipHydrationDose: (ml: number) => void;
  clearSkippedDose: () => void;
  advanceHydrationReminder: () => void;
  recalculateHydrationSchedule: () => void;

  // Sleep sessions
  addSleepSession: (start: string, end: string, durationMin: number) => Promise<void>;
  loadSleepSessions: (period?: 'today' | 'week') => Promise<void>;

  // Reminders
  addReminder: (text: string, triggerAt: string) => Promise<void>;
  loadReminders: () => Promise<void>;

  addTask: (title: string, priority?: Task['priority'], dueDate?: string | null, notes?: string, recurrence?: string | null) => Promise<void>;
  updateTask: (taskId: string, fields: Partial<Task>) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  loadTasks: () => Promise<void>;

  enqueueEvent: (type: string, payload: Record<string, unknown>) => Promise<void>;
  loadQueue: () => Promise<void>;
  drainQueue: () => Promise<void>;

  addChatSession: () => Promise<string>;
  setCurrentChat: (chatId: string | null) => void;
  loadChatSessions: () => Promise<void>;
  loadAiCommandsForChat: (chatId: string) => Promise<void>;
  addAiCommand: (input: string, source?: AiCommand['source']) => Promise<string>;
  resolveAiCommand: (id: string, output: string, status: AiCommand['status']) => Promise<void>;
  loadAiCommands: () => Promise<void>;
  updateChatTitle: (chatId: string, title: string) => Promise<void>;
  deleteChatSession: (chatId: string) => Promise<void>;

  // AI Memory
  addAiMemory: (fact: string, category?: string, sourceCmdId?: string, expiresAt?: string) => Promise<void>;
  deleteAiMemory: (id: string) => Promise<void>;
  updateAiMemory: (id: string, fact: string) => Promise<void>;
  loadAiMemories: () => Promise<void>;
  getMemoryFacts: () => string[];
  setCheckinIntervalMin: (minutes: number) => void;
  setProactiveQuietHours: (afterHour: number, beforeHour: number) => void;
  loadSeenPackages: () => void;
  setAllowedNotifPackages: (packages: string[]) => void;

  // Partner
  setPartnerStatus: (partnerId: string, online: boolean, lastSeen: string) => void;
  sendSnippet: (partnerId: string, content: string) => Promise<void>;
  loadPartnerSnippets: () => Promise<void>;

  // Google integration
  setGoogleConnected: (connected: boolean, email?: string | null) => void;
  syncCalendarEvents: () => Promise<void>;
  loadCalendarEvents: () => Promise<void>;
  addCalendarEvent: (event: { summary: string; startDateTime: string; endDateTime: string; description?: string; location?: string; timeZone?: string }) => Promise<{ ok: boolean; error?: string }>;
  updateCalendarEvent: (eventId: string, fields: { summary?: string; startDateTime?: string; endDateTime?: string; description?: string; location?: string; timeZone?: string }) => Promise<void>;
  deleteCalendarEvent: (eventId: string) => Promise<void>;
  syncEmails: () => Promise<void>;
  loadEmails: () => Promise<void>;
  triageEmails: () => Promise<void>;
  markEmailRead: (messageId: string) => Promise<void>;
  toggleEmailStar: (messageId: string, starred: boolean) => Promise<void>;
  extractTasksFromEmails: () => Promise<string[]>;

  // On-device LLM — fast model (0.5B chat)
  llmFastModelStatus: ModelStatus;
  llmFastModelPath: string | null;
  llmFastDownloadProgress: DownloadProgress | null;
  downloadFastModel: () => Promise<void>;

  // On-device LLM — heavy model (3B reasoning)
  llmModelStatus: ModelStatus;
  llmModelPath: string | null;
  llmDownloadProgress: DownloadProgress | null;
  llmError: string | null;
  llmLoaded: boolean;
  /** Partial text from on-device LLM streaming (null = not streaming). */
  llmStreamingText: string | null;
  downloadLlmModel: () => Promise<void>;
  deleteLlmModel: () => Promise<void>;

  // PicoClaw — Routines CRUD
  loadRoutines: () => Promise<void>;
  addRoutine: (name: string, triggerPhrases: string[], steps: import('../agent/types').RoutineStep[]) => Promise<void>;
  deleteRoutine: (id: string) => Promise<void>;

  // PicoClaw — Automation Rules CRUD
  loadAutomationRules: () => Promise<void>;
  addAutomationRule: (rule: Omit<import('../agent/types').AutomationRule, 'id' | 'createdAt' | 'lastTriggered'>) => Promise<void>;
  updateAutomationRule: (id: string, fields: Partial<import('../agent/types').AutomationRule>) => Promise<void>;
  deleteAutomationRule: (id: string) => Promise<void>;
}

let _initPromise: Promise<void> | null = null;

// Seed backend URL from .env if not already set in MMKV
const ENV_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';
if (ENV_BACKEND_URL && !kv.getString('backend_url')) {
  kv.set('backend_url', ENV_BACKEND_URL.replace(/\/+$/, ''));
}

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  isOnline: true,
  isBackendConfigured: !!kv.getString('backend_url') || !!ENV_BACKEND_URL,
  isAuthenticated: !!kv.getString('user_id'),

  sleep: kv.getJSON<SleepState>('sleep') ?? {
    isAsleep: false, sleepStart: null, sleepEnd: null, durationMinutes: 0,
  },

  hydrationTodayMl: kv.getNumber('hydration_today'),
  hydrationLogs: [],

  focusEnabled: kv.getBool('focus_enabled'),
  focusStartedAt: kv.getString('focus_started'),
  focusDurationMin: kv.getNumber('focus_duration') || 45,
  focusRemainingMin: kv.getNumber('focus_remaining'),

  tasks: [],
  sleepSessions: [],
  reminders: [],
  queueCount: kv.getNumber('queue_count'),
  queuedEvents: [],
  chatSessions: [],
  currentChatId: kv.getString('current_chat_id') || null,
  aiCommands: [],
  aiMemories: [],
  proactiveAIEnabled: true as const,
  checkinIntervalMin: kv.getNumber('proactive_checkin_interval_min') || 90,
  proactiveQuietAfterHour: kv.getNumber('proactive_quiet_after_hour') ?? 21,
  proactiveQuietBeforeHour: kv.getNumber('proactive_quiet_before_hour') ?? 7,
  notificationListenerEnabled: true,
  seenNotifPackages: JSON.parse(kv.getString('seen_notif_packages') || '[]'),
  allowedNotifPackages: JSON.parse(kv.getString('allowed_notif_packages') || '[]'),
  partners: [],
  partnerSnippets: [],
  routines: [],
  automationRules: [],

  autoMorningEnabled: kv.getBool('auto_morning_enabled') ?? true,
  autoNightEnabled: kv.getBool('auto_night_enabled') ?? true,

  hydrationReminderEnabled: kv.getBool('hydration_reminder_enabled'),
  hydrationStartHour: kv.getNumber('hydration_start_hour') || 8,
  hydrationEndHour: kv.getNumber('hydration_end_hour') || 22,
  hydrationGoalMl: kv.getNumber('hydration_goal_ml') || 2500,
  hydrationIntervalMin: kv.getNumber('hydration_interval_min') || 84,
  nextHydrationReminderAt: kv.getString('hydration_next_at') ?? null,
  hydrationDosePerReminder: kv.getNumber('hydration_dose_per') || 250,
  hydrationSkippedMl: kv.getNumber('hydration_skipped_ml'),

  isGoogleConnected: kv.getBool('google_connected'),
  googleEmail: kv.getString('google_email') || null,
  calendarEvents: [],
  calendarSyncing: false,
  calendarLastSynced: null,
  lastCalendarError: null,
  emails: [],
  emailSyncing: false,
  emailLastSynced: null,
  lastEmailError: null,
  unreadEmailCount: 0,

  // Streaks & daily score
  currentStreak: 0,
  dailyScore: 0,
  streakData: [],
  scoreBreakdown: { hydration: 0, tasks: 0, sleep: 0, habits: 0 },

  // Habits
  habits: [],
  habitLogs: [],

  // Mood & Energy
  moodLogs: [],

  // Notes
  notes: [],

  // Inbox
  inboxItems: [],

  // Time Blocks
  timeBlocks: [],

  // Expenses
  expenses: [],
  budgets: [],
  todaySpend: 0,
  monthSpend: 0,

  // On-device LLM — fast model (0.5B)
  llmFastModelStatus: kv.getString('llm_fast_model_path') ? 'downloaded' : 'not_downloaded' as ModelStatus,
  llmFastModelPath: kv.getString('llm_fast_model_path') || null,
  llmFastDownloadProgress: null,

  // On-device LLM — heavy model (3B)
  llmModelStatus: kv.getString('llm_model_path') ? 'downloaded' : 'not_downloaded' as ModelStatus,
  llmModelPath: kv.getString('llm_model_path') || null,
  llmDownloadProgress: null,
  llmError: null,
  llmLoaded: false,
  llmStreamingText: null,

  // ── Init: load everything from SQLite + restore auth ──
  init: async () => {
    if (get().ready) return;
    // Singleton — all concurrent callers share one init
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
    try {
      const db = await getDatabase();

      // Tasks
      const tasks = await db.getAllAsync<Task>(
        'SELECT * FROM tasks ORDER BY created_at DESC'
      );

      // Hydration today
      const todayStart = dayjs().startOf('day').toISOString();
      const hydRow = await db.getFirstAsync<{ total: number }>(
        'SELECT COALESCE(SUM(amount_ml),0) as total FROM hydration_logs WHERE timestamp >= ?',
        [todayStart]
      );
      const hydrationTodayMl = hydRow?.total ?? 0;
      kv.set('hydration_today', hydrationTodayMl);

      // Recent hydration logs
      const hydrationLogs = await db.getAllAsync<HydrationLog>(
        'SELECT * FROM hydration_logs WHERE timestamp >= ? ORDER BY timestamp DESC',
        [todayStart]
      );

      // Queue
      const queuedEvents = await db.getAllAsync<QueuedEvent>(
        "SELECT * FROM event_queue WHERE status = 'pending' ORDER BY created_at ASC"
      );

      // Chat sessions (for sidebar)
      const chatSessions = await db.getAllAsync<ChatSession>(
        'SELECT id, title, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT 100'
      );
      const currentChatId = kv.getString('current_chat_id') || (chatSessions[0]?.id ?? null);

      // AI commands for current chat only; empty when no chat selected (new chat flow)
      let aiCommands: AiCommand[] = [];
      if (currentChatId) {
        aiCommands = (await db.getAllAsync<AiCommand & { source?: string }>(
          'SELECT * FROM ai_commands WHERE chat_id = ? ORDER BY created_at ASC',
          [currentChatId]
        )).map(c => ({ ...c, chat_id: c.chat_id ?? currentChatId, source: (c.source || 'user') as AiCommand['source'] }));
      }

      // AI memories — load non-expired facts
      const aiMemories = await db.getAllAsync<AiMemory>(
        "SELECT * FROM ai_memory WHERE expires_at IS NULL OR expires_at > datetime('now') ORDER BY created_at DESC LIMIT 100"
      );
      // Clean up expired memories in background
      db.runAsync("DELETE FROM ai_memory WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')").catch(() => {});

      // Partner snippets
      const partnerSnippets = await db.getAllAsync<PartnerSnippet>(
        'SELECT * FROM partner_snippets ORDER BY timestamp DESC LIMIT 50'
      );

      // Sleep sessions (today)
      const sleepSessions = await db.getAllAsync<import('../agent/types').SleepSession>(
        'SELECT * FROM sleep_sessions WHERE sleep_start >= ? ORDER BY sleep_start DESC',
        [todayStart]
      );

      // Reminders (unfired)
      const reminderRows = await db.getAllAsync<{
        reminder_id: string; text: string; trigger_at: string; fired: number; created_at: string;
      }>('SELECT * FROM reminders WHERE fired = 0 ORDER BY trigger_at ASC');
      const reminders: import('../agent/types').Reminder[] = reminderRows.map(r => ({
        ...r, fired: !!r.fired,
      }));

      // PicoClaw — user routines
      const { parseRoutineRow } = await import('../agent/routines');
      const routineRows = await db.getAllAsync<{
        id: string; name: string; trigger_phrases: string; steps: string; enabled: number; created_at: string;
      }>('SELECT * FROM routines WHERE enabled = 1');
      const routines = routineRows.map(parseRoutineRow);

      // PicoClaw — automation rules
      const ruleRows = await db.getAllAsync<{
        id: string; name: string; description: string; rule_type: string; schedule: string;
        condition: string; actions: string; enabled: number; last_triggered: string; created_at: string;
      }>('SELECT * FROM automation_rules');
      const automationRules = ruleRows.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description || '',
        ruleType: r.rule_type as 'schedule' | 'condition',
        schedule: r.schedule || null,
        condition: r.condition || null,
        actions: JSON.parse(r.actions),
        enabled: !!r.enabled,
        lastTriggered: r.last_triggered || null,
        createdAt: r.created_at,
      }));

      // Google — cached calendar events
      const calendarEvents = (await db.getAllAsync<{
        event_id: string; summary: string; description: string; location: string;
        start_time: string; end_time: string; all_day: number; status: string;
        html_link: string; google_calendar_id: string; synced_at: string;
      }>('SELECT * FROM calendar_events ORDER BY start_time ASC')).map(r => ({
        ...r, all_day: !!r.all_day, description: r.description || null,
        location: r.location || null, html_link: r.html_link || null,
      }));

      // Google — cached emails with categories
      const emailRows = await db.getAllAsync<{
        message_id: string; thread_id: string; from_address: string; subject: string;
        snippet: string; date: string; is_unread: number; is_starred: number;
        label_ids: string; body_text: string;
      }>('SELECT * FROM email_cache ORDER BY date DESC LIMIT 50');
      const emailCatRows = await db.getAllAsync<{
        message_id: string; category: string; extracted_tasks: string;
      }>('SELECT * FROM email_categories');
      const catMap = new Map(emailCatRows.map(r => [r.message_id, r]));
      const emails: CachedEmail[] = emailRows.map(r => {
        const cat = catMap.get(r.message_id);
        return {
          message_id: r.message_id, thread_id: r.thread_id,
          from_address: r.from_address, subject: r.subject,
          snippet: r.snippet || '', date: r.date,
          is_unread: !!r.is_unread, is_starred: !!r.is_starred,
          label_ids: r.label_ids ? JSON.parse(r.label_ids) : [],
          category: (cat?.category as CachedEmail['category']) ?? null,
          extracted_tasks: cat?.extracted_tasks ? JSON.parse(cat.extracted_tasks) : [],
        };
      });
      const unreadEmailCount = emails.filter(e => e.is_unread).length;

      set({
        ready: true,
        tasks,
        sleepSessions,
        reminders,
        hydrationTodayMl,
        hydrationLogs: hydrationLogs.map(l => ({ ...l, synced: !!l.synced })),
        queueCount: queuedEvents.length,
        queuedEvents,
        chatSessions,
        currentChatId,
        aiCommands,
        aiMemories,
        partnerSnippets,
        routines,
        automationRules,
        isBackendConfigured: !!kv.getString('backend_url'),
        isAuthenticated: !!kv.getString('user_id'),
        isGoogleConnected: kv.getBool('google_connected'),
        googleEmail: kv.getString('google_email') || null,
        calendarEvents,
        emails,
        unreadEmailCount,
      });

      // Restore backend auth + MQTT if configured
      if (kv.getString('backend_url') && kv.getString('user_id')) {
        try {
          const { auth } = await import('../services/auth');
          const restored = await auth.restore();
          set({ isAuthenticated: restored });
        } catch (e) {
          console.log('[LifeOS] Auth restore skipped:', e);
        }
      }
      // Ensure non-negotiable features are always on
      kv.set('encryption_enabled', true);
      kv.set('notifications_enabled', true);

      // Load habits & calculate streaks
      get().loadHabits();
      get().loadMoodLogs();
      get().loadNotes();
      get().loadInbox();
      get().loadTimeBlocks();
      get().loadExpenses();
      get().loadBudgets();
      get().updateDailyStreak();

      // Rebuild FTS5 search index in background (non-blocking)
      import('../db/search').then(({ rebuildSearchIndex }) => {
        rebuildSearchIndex().catch(e => console.warn('[LifeOS] Search index rebuild failed:', e));
      });

      // Auto-download LLM models if not present (fast first — it's tiny)
      const FileSystem = await import('expo-file-system/legacy');

      const fastPath = kv.getString('llm_fast_model_path');
      if (fastPath) {
        const info = await FileSystem.getInfoAsync(fastPath);
        if (!info.exists) {
          kv.delete('llm_fast_model_path');
          set({ llmFastModelStatus: 'not_downloaded', llmFastModelPath: null });
          get().downloadFastModel();
        }
      } else {
        get().downloadFastModel();
      }

      const llmPath = kv.getString('llm_model_path');
      if (llmPath) {
        const info = await FileSystem.getInfoAsync(llmPath);
        if (!info.exists) {
          kv.delete('llm_model_path');
          set({ llmModelStatus: 'not_downloaded', llmModelPath: null });
          get().downloadLlmModel();
        }
      } else {
        get().downloadLlmModel();
      }
    } catch (e) {
      console.error('[LifeOS] init failed:', e);
      set({ ready: true });
    }
    })();
    return _initPromise;
  },

  setOnline: (v) => set({ isOnline: v }),
  setBackendConfigured: (v) => set({ isBackendConfigured: v }),
  setAuthenticated: (v) => set({ isAuthenticated: v }),

  // ── LLM model management ──

  // Fast model (0.5B)
  downloadFastModel: async () => {
    if (get().llmFastModelStatus === 'downloading') return;
    const { FAST_MODEL } = await import('../llm/types');
    const ModelManager = await import('../llm/ModelManager');

    set({
      llmFastModelStatus: 'downloading',
      llmFastDownloadProgress: { totalBytes: FAST_MODEL.sizeBytes, downloadedBytes: 0, percent: 0 },
    });

    try {
      const handle = ModelManager.download('fast', (progress) => {
        set({ llmFastDownloadProgress: progress });
      });
      await handle.downloadAsync();
      const path = ModelManager.modelPath('fast');
      kv.set('llm_fast_model_path', path);
      set({ llmFastModelStatus: 'downloaded', llmFastModelPath: path, llmFastDownloadProgress: null });
      console.log('[LLM] Fast model downloaded:', path);
    } catch (e) {
      console.error('[LLM] Fast model download failed:', e);
      set({ llmFastModelStatus: 'error', llmFastDownloadProgress: null });
    }
  },

  // Heavy model (3B)
  downloadLlmModel: async () => {
    if (get().llmModelStatus === 'downloading') return;
    const { HEAVY_MODEL } = await import('../llm/types');
    const ModelManager = await import('../llm/ModelManager');

    set({
      llmModelStatus: 'downloading',
      llmError: null,
      llmDownloadProgress: { totalBytes: HEAVY_MODEL.sizeBytes, downloadedBytes: 0, percent: 0 },
    });

    try {
      const handle = ModelManager.download('heavy', (progress) => {
        set({ llmDownloadProgress: progress });
      });
      await handle.downloadAsync();
      const path = ModelManager.modelPath('heavy');
      kv.set('llm_model_path', path);
      set({ llmModelStatus: 'downloaded', llmModelPath: path, llmDownloadProgress: null });
      console.log('[LLM] Heavy model downloaded:', path);
    } catch (e) {
      console.error('[LLM] Heavy model download failed:', e);
      set({
        llmModelStatus: 'error',
        llmError: `Download failed: ${(e as Error).message}`,
        llmDownloadProgress: null,
      });
    }
  },

  deleteLlmModel: async () => {
    const { LlamaService } = await import('../llm/LlamaService');
    const ModelManager = await import('../llm/ModelManager');
    await LlamaService.release();
    await ModelManager.deleteModel('fast');
    await ModelManager.deleteModel('heavy');
    kv.delete('llm_fast_model_path');
    kv.delete('llm_model_path');
    set({
      llmFastModelStatus: 'not_downloaded', llmFastModelPath: null,
      llmModelStatus: 'not_downloaded', llmModelPath: null, llmLoaded: false,
    });
  },

  setSleep: (s) => {
    const newSleep = { ...get().sleep, ...s };
    kv.setJSON('sleep', newSleep);
    set({ sleep: newSleep });
  },

  // ── Hydration ──
  logHydration: async (ml) => {
    const db = await getDatabase();
    const id = uid();
    const ts = dayjs().toISOString();
    await db.runAsync(
      'INSERT INTO hydration_logs (log_id, amount_ml, timestamp, synced) VALUES (?,?,?,0)',
      [id, ml, ts]
    );
    const newTotal = get().hydrationTodayMl + ml;
    kv.set('hydration_today', newTotal);
    const log: HydrationLog = { log_id: id, amount_ml: ml, timestamp: ts, synced: false };
    set({
      hydrationTodayMl: newTotal,
      hydrationLogs: [log, ...get().hydrationLogs],
    });

    // Sync to backend or queue — SYSTEM.md §5
    if (!get().isOnline) {
      await get().enqueueEvent('hydration', { log_id: id, amount_ml: ml, timestamp: ts });
    } else if (get().isBackendConfigured && get().isAuthenticated) {
      try {
        const { api } = await import('../services/api');
        const result = await api.logHydration({ log_id: id, amount_ml: ml, timestamp: ts });
        if (result.ok) {
          await db.runAsync('UPDATE hydration_logs SET synced = 1 WHERE log_id = ?', [id]);
          set({
            hydrationLogs: get().hydrationLogs.map(l =>
              l.log_id === id ? { ...l, synced: true } : l
            ),
          });
        }
      } catch {
        await get().enqueueEvent('hydration', { log_id: id, amount_ml: ml, timestamp: ts });
      }
    }

    // Update streak after logging hydration
    get().updateDailyStreak();
  },

  loadHydrationToday: async () => {
    const db = await getDatabase();
    const todayStart = dayjs().startOf('day').toISOString();
    const row = await db.getFirstAsync<{ total: number }>(
      'SELECT COALESCE(SUM(amount_ml),0) as total FROM hydration_logs WHERE timestamp >= ?',
      [todayStart]
    );
    const total = row?.total ?? 0;
    kv.set('hydration_today', total);
    set({ hydrationTodayMl: total });
  },

  // ── Sleep sessions ──
  addSleepSession: async (start, end, durationMin) => {
    const db = await getDatabase();
    const id = uid();
    await db.runAsync(
      'INSERT INTO sleep_sessions (session_id, sleep_start, sleep_end, duration_minutes) VALUES (?,?,?,?)',
      [id, start, end, durationMin]
    );
    const session: import('../agent/types').SleepSession = {
      session_id: id, sleep_start: start, sleep_end: end, duration_minutes: durationMin,
    };
    set({ sleepSessions: [session, ...get().sleepSessions] });
    get().updateDailyStreak();
  },

  loadSleepSessions: async (period = 'today') => {
    const db = await getDatabase();
    const since = period === 'week'
      ? dayjs().subtract(7, 'day').startOf('day').toISOString()
      : dayjs().startOf('day').toISOString();
    const rows = await db.getAllAsync<import('../agent/types').SleepSession>(
      'SELECT * FROM sleep_sessions WHERE sleep_start >= ? ORDER BY sleep_start DESC',
      [since]
    );
    set({ sleepSessions: rows });
  },

  // ── Reminders ──
  addReminder: async (text, triggerAt) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      'INSERT INTO reminders (reminder_id, text, trigger_at, fired, created_at) VALUES (?,?,?,0,?)',
      [id, text, triggerAt, now]
    );
    const reminder: import('../agent/types').Reminder = {
      reminder_id: id, text, trigger_at: triggerAt, fired: false, created_at: now,
    };
    set({ reminders: [...get().reminders, reminder].sort((a, b) => a.trigger_at.localeCompare(b.trigger_at)) });
  },

  loadReminders: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      reminder_id: string; text: string; trigger_at: string; fired: number; created_at: string;
    }>('SELECT * FROM reminders WHERE fired = 0 ORDER BY trigger_at ASC');
    set({ reminders: rows.map(r => ({ ...r, fired: !!r.fired })) });
  },

  // ── Auto sleep/wake routines ──
  setAutoMorning: (v) => {
    kv.set('auto_morning_enabled', v);
    set({ autoMorningEnabled: v });
  },
  setAutoNight: (v) => {
    kv.set('auto_night_enabled', v);
    set({ autoNightEnabled: v });
  },

  // ── Hydration reminders ──
  setHydrationReminder: (startHour, endHour, goalMl, customIntervalMin) => {
    const { calculateSchedule } = require('../utils/hydrationCalc') as typeof import('../utils/hydrationCalc');
    const schedule = calculateSchedule(startHour, endHour, goalMl, get().hydrationTodayMl, customIntervalMin);

    kv.set('hydration_reminder_enabled', true);
    kv.set('hydration_start_hour', startHour);
    kv.set('hydration_end_hour', endHour);
    kv.set('hydration_goal_ml', goalMl);
    kv.set('hydration_interval_min', schedule.intervalMin);
    kv.set('hydration_next_at', schedule.firstReminderAt);
    kv.set('hydration_dose_per', schedule.dosePerReminderMl);
    kv.set('hydration_skipped_ml', 0);

    set({
      hydrationReminderEnabled: true,
      hydrationStartHour: startHour,
      hydrationEndHour: endHour,
      hydrationGoalMl: goalMl,
      hydrationIntervalMin: schedule.intervalMin,
      nextHydrationReminderAt: schedule.firstReminderAt,
      hydrationDosePerReminder: schedule.dosePerReminderMl,
      hydrationSkippedMl: 0,
    });
  },

  disableHydrationReminder: () => {
    kv.set('hydration_reminder_enabled', false);
    kv.set('hydration_skipped_ml', 0);
    set({
      hydrationReminderEnabled: false,
      hydrationSkippedMl: 0,
      nextHydrationReminderAt: null,
    });
  },

  skipHydrationDose: (ml) => {
    const newSkipped = get().hydrationSkippedMl + ml;
    kv.set('hydration_skipped_ml', newSkipped);
    set({ hydrationSkippedMl: newSkipped });
  },

  clearSkippedDose: () => {
    kv.set('hydration_skipped_ml', 0);
    set({ hydrationSkippedMl: 0 });
  },

  advanceHydrationReminder: () => {
    const { nextHydrationReminderAt, hydrationIntervalMin } = get();
    if (!nextHydrationReminderAt) return;
    const next = dayjs(nextHydrationReminderAt).add(hydrationIntervalMin, 'minute').toISOString();
    kv.set('hydration_next_at', next);
    set({ nextHydrationReminderAt: next });
  },

  recalculateHydrationSchedule: () => {
    const { recalculateAfterFocus } = require('../utils/hydrationCalc') as typeof import('../utils/hydrationCalc');
    const s = get();
    const { newDosePerReminder } = recalculateAfterFocus(
      s.hydrationEndHour, s.hydrationGoalMl,
      s.hydrationTodayMl, s.hydrationIntervalMin,
    );
    kv.set('hydration_dose_per', newDosePerReminder);
    kv.set('hydration_skipped_ml', 0);
    set({ hydrationDosePerReminder: newDosePerReminder, hydrationSkippedMl: 0 });
  },

  // ── Focus mode ──
  toggleFocus: (durationMin = 45) => {
    const enabled = !get().focusEnabled;
    const now = dayjs().toISOString();
    kv.set('focus_enabled', enabled);
    if (enabled) {
      kv.set('focus_started', now);
      kv.set('focus_duration', durationMin);
      kv.set('focus_remaining', durationMin);
      set({ focusEnabled: true, focusStartedAt: now, focusDurationMin: durationMin, focusRemainingMin: durationMin });
    } else {
      set({ focusEnabled: false, focusStartedAt: null, focusRemainingMin: 0 });
      // Recalculate hydration schedule if reminders are active and doses were skipped
      if (get().hydrationReminderEnabled && get().hydrationSkippedMl > 0) {
        get().recalculateHydrationSchedule();
      }
    }
  },

  tickFocus: () => {
    const r = get().focusRemainingMin;
    if (r <= 1) {
      kv.set('focus_enabled', false);
      set({ focusEnabled: false, focusRemainingMin: 0 });
      // Recalculate hydration schedule if reminders are active and doses were skipped
      if (get().hydrationReminderEnabled && get().hydrationSkippedMl > 0) {
        get().recalculateHydrationSchedule();
      }
    } else {
      kv.set('focus_remaining', r - 1);
      set({ focusRemainingMin: r - 1 });
    }
  },

  // ── Tasks CRUD ──
  addTask: async (title, priority = 'medium', dueDate = null, notes = '', recurrence = null) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      'INSERT INTO tasks (task_id,title,due_date,priority,notes,status,recurrence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, title, dueDate, priority, notes, 'pending', recurrence, now, now]
    );
    const task: Task = { task_id: id, title, due_date: dueDate, priority, notes, status: 'pending', recurrence, created_at: now, updated_at: now };
    set({ tasks: [task, ...get().tasks] });
    ftsIndex('task', id, title, notes, priority, dueDate ?? '');
  },

  updateTask: async (taskId, fields) => {
    const db = await getDatabase();
    const now = dayjs().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [now];
    for (const [k, v] of Object.entries(fields)) {
      if (k !== 'task_id' && k !== 'created_at') {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    vals.push(taskId);
    await db.runAsync(`UPDATE tasks SET ${sets.join(', ')} WHERE task_id = ?`, vals as string[]);
    set({
      tasks: get().tasks.map(t =>
        t.task_id === taskId ? { ...t, ...fields, updated_at: now } : t
      ),
    });

    // Update streak when task completed
    if (fields.status === 'completed') {
      get().updateDailyStreak();
    }

    // Auto-create next occurrence for recurring tasks on completion
    if (fields.status === 'completed') {
      const task = get().tasks.find(t => t.task_id === taskId);
      if (task?.recurrence) {
        try {
          const { calculateNextDueDate } = await import('../utils/recurrence');
          const nextDue = calculateNextDueDate(task.recurrence, task.due_date ?? now);
          await get().addTask(task.title, task.priority, nextDue, task.notes, task.recurrence);
        } catch (e) {
          console.error('[LifeOS] Failed to create next recurring task:', e);
        }
      }
    }
  },

  deleteTask: async (taskId) => {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM tasks WHERE task_id = ?', [taskId]);
    set({ tasks: get().tasks.filter(t => t.task_id !== taskId) });
    ftsRemove(taskId);
  },

  loadTasks: async () => {
    const db = await getDatabase();
    const tasks = await db.getAllAsync<Task>('SELECT * FROM tasks ORDER BY created_at DESC');
    set({ tasks });
  },

  // ── Offline queue — SYSTEM.md §5 ──
  enqueueEvent: async (type, payload) => {
    const db = await getDatabase();
    const id = uid();
    await db.runAsync(
      "INSERT INTO event_queue (id,type,payload,created_at,retry_count,status) VALUES (?,?,?,?,0,'pending')",
      [id, type, JSON.stringify(payload), dayjs().toISOString()]
    );
    const newCount = get().queueCount + 1;
    kv.set('queue_count', newCount);
    set({ queueCount: newCount });
  },

  loadQueue: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<QueuedEvent>(
      "SELECT * FROM event_queue WHERE status = 'pending' ORDER BY created_at ASC"
    );
    set({ queuedEvents: rows, queueCount: rows.length });
    kv.set('queue_count', rows.length);
  },

  drainQueue: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<QueuedEvent>(
      "SELECT * FROM event_queue WHERE status = 'pending'"
    );

    if (rows.length === 0) return;

    // If backend is configured and authenticated, send batch to server
    if (get().isBackendConfigured && get().isAuthenticated) {
      try {
        const { api } = await import('../services/api');
        const result = await api.syncBatch(rows);

        if (result.ok) {
          const failedIds = new Set(result.data.failed);

          for (const row of rows) {
            if (failedIds.has(row.id)) {
              // Increment retry count for failed events
              await db.runAsync(
                'UPDATE event_queue SET retry_count = retry_count + 1 WHERE id = ?',
                [row.id]
              );
            } else {
              // Successfully synced — delete from queue
              await db.runAsync('DELETE FROM event_queue WHERE id = ?', [row.id]);

              // Mark corresponding records as synced
              try {
                const payload = JSON.parse(row.payload);
                if (row.type === 'hydration' && payload.log_id) {
                  await db.runAsync('UPDATE hydration_logs SET synced = 1 WHERE log_id = ?', [payload.log_id]);
                }
              } catch { /* ignore parse errors */ }
            }
          }

          // Update queue count
          const remaining = await db.getAllAsync<QueuedEvent>(
            "SELECT * FROM event_queue WHERE status = 'pending'"
          );
          kv.set('queue_count', remaining.length);
          set({ queueCount: remaining.length, queuedEvents: remaining });
          return;
        }
      } catch (e) {
        console.error('[LifeOS] Batch sync failed:', e);
        // Fall through to local-only drain below
      }
    }

    // No backend or sync failed — clear queue locally (offline-only mode)
    for (const row of rows) {
      console.log(`[LifeOS] Local drain ${row.type}:`, row.payload);
      await db.runAsync('DELETE FROM event_queue WHERE id = ?', [row.id]);
    }
    kv.set('queue_count', 0);
    set({ queueCount: 0, queuedEvents: [] });
  },

  // ── Chat sessions ──
  addChatSession: async () => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      'INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [id, 'New chat', now, now]
    );
    const session: ChatSession = { id, title: 'New chat', created_at: now, updated_at: now };
    kv.set('current_chat_id', id);
    set({
      currentChatId: id,
      chatSessions: [session, ...get().chatSessions],
      aiCommands: [],
    });
    return id;
  },

  setCurrentChat: (chatId) => {
    if (chatId) kv.set('current_chat_id', chatId);
    else kv.delete('current_chat_id');
    set({ currentChatId: chatId });
    if (chatId) get().loadAiCommandsForChat(chatId).catch(() => {});
    else set({ aiCommands: [] });
  },

  loadChatSessions: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<ChatSession>(
      'SELECT id, title, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT 100'
    );
    set({ chatSessions: rows });
  },

  loadAiCommandsForChat: async (chatId) => {
    const db = await getDatabase();
    const rows = (await db.getAllAsync<AiCommand & { source?: string }>(
      'SELECT * FROM ai_commands WHERE chat_id = ? ORDER BY created_at ASC',
      [chatId]
    )).map(c => ({ ...c, chat_id: c.chat_id ?? chatId, source: (c.source || 'user') as AiCommand['source'] }));
    set({ aiCommands: rows });
  },

  updateChatTitle: async (chatId, title) => {
    const db = await getDatabase();
    const now = dayjs().toISOString();
    await db.runAsync('UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?', [title, now, chatId]);
    set({
      chatSessions: get().chatSessions.map(s => s.id === chatId ? { ...s, title, updated_at: now } : s),
    });
  },

  deleteChatSession: async (chatId) => {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM ai_commands WHERE chat_id = ?', [chatId]);
    await db.runAsync('DELETE FROM chat_sessions WHERE id = ?', [chatId]);
    const sessions = get().chatSessions.filter(s => s.id !== chatId);
    const nextId = sessions[0]?.id ?? null;
    if (get().currentChatId === chatId) {
      if (nextId) kv.set('current_chat_id', nextId);
      else kv.delete('current_chat_id');
      set({ currentChatId: nextId, chatSessions: sessions, aiCommands: [] });
      if (nextId) get().loadAiCommandsForChat(nextId);
    } else {
      set({ chatSessions: sessions });
    }
  },

  // ── AI commands ──
  addAiCommand: async (input, source = 'user') => {
    const db = await getDatabase();
    let chatId = get().currentChatId;
    if (!chatId) {
      chatId = await get().addChatSession();
    }
    const id = uid();
    const now = dayjs().toISOString();
    const status = get().isOnline ? 'pending' : 'queued';
    await db.runAsync(
      'INSERT INTO ai_commands (id, chat_id, input, output, status, source, created_at) VALUES (?,?,?,?,?,?,?)',
      [id, chatId, input, null, status, source, now]
    );
    await db.runAsync('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', [now, chatId]);
    const cmd: AiCommand = { id, chat_id: chatId, input, output: null, status, source, created_at: now };
    set({ aiCommands: [...get().aiCommands, cmd] });

    if (!get().isOnline) {
      await get().enqueueEvent('ai_command', { id, input });
    }
    return id;
  },

  resolveAiCommand: async (id, output, status) => {
    const db = await getDatabase();
    await db.runAsync('UPDATE ai_commands SET output = ?, status = ? WHERE id = ?', [output, status, id]);
    const cmd = get().aiCommands.find(c => c.id === id);
    const now = dayjs().toISOString();
    if (cmd?.chat_id) {
      await db.runAsync('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', [now, cmd.chat_id]);
      const session = get().chatSessions.find(s => s.id === cmd.chat_id);
      if (session?.title === 'New chat' && cmd.source === 'user') {
        // Quick fallback title
        const fallbackTitle = cmd.input.slice(0, 42) + (cmd.input.length > 42 ? '…' : '');
        await db.runAsync('UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?', [fallbackTitle, now, cmd.chat_id]);
        set({
          chatSessions: get().chatSessions.map(s =>
            s.id === cmd.chat_id ? { ...s, title: fallbackTitle, updated_at: now } : s
          ),
        });

        // Async smart title: use fast LLM if loaded (non-blocking)
        const chatId = cmd.chat_id;
        const userInput = cmd.input;
        const aiOutput = output;
        (async () => {
          try {
            const { LlamaService } = await import('../llm/LlamaService');
            if (!LlamaService.isFastLoaded) return;
            const result = await LlamaService.completeFast(
              `Summarize this conversation in 3-5 words as a chat title. Output ONLY the title, nothing else.\nUser: ${userInput}\nAssistant: ${(aiOutput || '').slice(0, 200)}`,
              '',
            );
            const smartTitle = result.message.replace(/["'*]/g, '').replace(/^title:\s*/i, '').trim();
            if (smartTitle.length > 2 && smartTitle.length < 50 && !smartTitle.includes('\n')) {
              const db2 = await getDatabase();
              await db2.runAsync('UPDATE chat_sessions SET title = ? WHERE id = ?', [smartTitle, chatId]);
              set({
                chatSessions: get().chatSessions.map(s =>
                  s.id === chatId ? { ...s, title: smartTitle } : s
                ),
              });
            }
          } catch { /* silent — title generation is best-effort */ }
        })();
      }
    }
    set({
      aiCommands: get().aiCommands.map(c =>
        c.id === id ? { ...c, output, status } : c
      ),
    });
  },

  loadAiCommands: async () => {
    const chatId = get().currentChatId;
    if (chatId) return get().loadAiCommandsForChat(chatId);
    set({ aiCommands: [] });
  },

  // ── Streaks & Daily Score ──

  updateDailyStreak: async () => {
    const db = await getDatabase();
    const today = dayjs().format('YYYY-MM-DD');
    const state = get();

    // Calculate today's score (0-100)
    const hydrationMet = state.hydrationTodayMl >= (state.hydrationGoalMl || 2500) ? 1 : 0;
    const tasksCompleted = state.tasks.filter(t =>
      t.status === 'completed' && dayjs(t.updated_at).format('YYYY-MM-DD') === today
    ).length;
    const sleepLogged = state.sleep.durationMinutes > 0 ? 1 : 0;
    const habitsDone = state.habitLogs.filter(l =>
      dayjs(l.logged_at).format('YYYY-MM-DD') === today
    ).length;

    const hydrationPts = hydrationMet * 30;
    const taskPts = Math.min(tasksCompleted * 10, 40);
    const sleepPts = sleepLogged * 20;
    const habitPts = Math.min(habitsDone * 10, 10);
    const score = hydrationPts + taskPts + sleepPts + habitPts;

    await db.runAsync(
      `INSERT OR REPLACE INTO daily_streaks (date, hydration_met, tasks_completed, sleep_logged, habits_done, score)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [today, hydrationMet, tasksCompleted, sleepLogged, habitsDone, score]
    );

    // Calculate streak — consecutive days with score > 0
    const rows = await db.getAllAsync<{ date: string; score: number }>(
      'SELECT date, score FROM daily_streaks ORDER BY date DESC LIMIT 30'
    );

    let streak = 0;
    for (let i = 0; i < rows.length; i++) {
      const expected = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      if (rows[i].date === expected && rows[i].score > 0) {
        streak++;
      } else {
        break;
      }
    }

    set({
      currentStreak: streak,
      dailyScore: score,
      streakData: rows.slice(0, 7),
      scoreBreakdown: { hydration: hydrationPts, tasks: taskPts, sleep: sleepPts, habits: habitPts },
    });

    // Cache to MMKV for Android widget
    kv.set('daily_score', score);
    kv.set('current_streak', streak);
  },

  // ── Habits ──

  loadHabits: async () => {
    const db = await getDatabase();
    const since30d = dayjs().subtract(30, 'day').format('YYYY-MM-DD') + 'T00:00:00';
    const habits = await db.getAllAsync<Habit>('SELECT * FROM habits WHERE enabled = 1 ORDER BY created_at');
    const logs = await db.getAllAsync<HabitLog>(
      "SELECT * FROM habit_logs WHERE logged_at >= ? ORDER BY logged_at DESC",
      [since30d]
    );
    set({ habits, habitLogs: logs });
  },

  addHabit: async (name: string, icon = '✓', targetPerDay = 1, unit: string | null = null) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      'INSERT INTO habits (id, name, icon, target_per_day, unit, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name, icon, targetPerDay, unit, now]
    );
    const habit: Habit = { id, name, icon, target_per_day: targetPerDay, unit, enabled: true, created_at: now };
    set({ habits: [...get().habits, habit] });
    return id;
  },

  logHabitEntry: async (habitId: string, value = 1) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      'INSERT INTO habit_logs (id, habit_id, value, logged_at) VALUES (?, ?, ?, ?)',
      [id, habitId, value, now]
    );
    const log: HabitLog = { id, habit_id: habitId, value, logged_at: now };
    set({ habitLogs: [log, ...get().habitLogs] });
    // Update streak after logging
    get().updateDailyStreak();
  },

  deleteHabit: async (habitId: string) => {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM habits WHERE id = ?', [habitId]);
    await db.runAsync('DELETE FROM habit_logs WHERE habit_id = ?', [habitId]);
    set({
      habits: get().habits.filter(h => h.id !== habitId),
      habitLogs: get().habitLogs.filter(l => l.habit_id !== habitId),
    });
  },

  getHabitStats: (habitId: string) => {
    const logs = get().habitLogs.filter(l => l.habit_id === habitId);
    const habit = get().habits.find(h => h.id === habitId);
    const target = habit?.target_per_day ?? 1;

    // Group logs by date
    const byDate = new Map<string, number>();
    for (const l of logs) {
      const d = dayjs(l.logged_at).format('YYYY-MM-DD');
      byDate.set(d, (byDate.get(d) ?? 0) + l.value);
    }

    // Current streak
    let currentStreak = 0;
    for (let i = 0; i < 30; i++) {
      const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      if ((byDate.get(d) ?? 0) >= target) currentStreak++;
      else break;
    }

    // Best streak
    let bestStreak = 0;
    let tempStreak = 0;
    for (let i = 0; i < 30; i++) {
      const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      if ((byDate.get(d) ?? 0) >= target) {
        tempStreak++;
        bestStreak = Math.max(bestStreak, tempStreak);
      } else {
        tempStreak = 0;
      }
    }

    // Weekly count (last 7 days)
    let weeklyCount = 0;
    for (let i = 0; i < 7; i++) {
      const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      if ((byDate.get(d) ?? 0) >= target) weeklyCount++;
    }

    // Last 30 days data for heatmap
    const last30Days: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      last30Days.push({ date: d, count: byDate.get(d) ?? 0 });
    }

    return {
      currentStreak,
      bestStreak,
      weeklyCount,
      totalLogged: logs.reduce((s, l) => s + l.value, 0),
      last30Days,
    };
  },

  // ── Mood & Energy ──

  loadMoodLogs: async () => {
    const db = await getDatabase();
    const since = dayjs().subtract(30, 'day').format('YYYY-MM-DD') + 'T00:00:00';
    const rows = await db.getAllAsync<MoodLog>(
      'SELECT * FROM mood_logs WHERE logged_at >= ? ORDER BY logged_at DESC',
      [since]
    );
    set({ moodLogs: rows });
  },

  addMoodLog: async (mood, energy, note) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      'INSERT INTO mood_logs (id, mood, energy, note, logged_at) VALUES (?, ?, ?, ?, ?)',
      [id, mood, energy, note ?? null, now]
    );
    const log: MoodLog = { id, mood, energy, note: note ?? null, logged_at: now };
    set({ moodLogs: [log, ...get().moodLogs] });
  },

  // ── Notes ──

  loadNotes: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ id: string; title: string; body: string; category: string; pinned: number; created_at: string; updated_at: string }>(
      'SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC LIMIT 200'
    );
    set({ notes: rows.map(r => ({ ...r, pinned: !!r.pinned, category: r.category as 'note' | 'journal' })) });
  },

  addNote: async (title, body = '', category = 'note') => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      'INSERT INTO notes (id, title, body, category, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
      [id, title, body, category, now, now]
    );
    const note: Note = { id, title, body, category, pinned: false, created_at: now, updated_at: now };
    set({ notes: [note, ...get().notes] });
    ftsIndex('note', id, title, body, category, now);
    return id;
  },

  updateNote: async (id, fields) => {
    const db = await getDatabase();
    const now = dayjs().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [now];
    for (const [k, v] of Object.entries(fields)) {
      if (k !== 'id' && k !== 'created_at') {
        sets.push(`${k} = ?`);
        vals.push(k === 'pinned' ? (v ? 1 : 0) : v);
      }
    }
    vals.push(id);
    await db.runAsync(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`, vals as string[]);
    const updated = { ...get().notes.find(n => n.id === id)!, ...fields, updated_at: now };
    set({ notes: get().notes.map(n => n.id === id ? updated : n) });
    ftsIndex('note', id, updated.title, updated.body, updated.category, now);
  },

  deleteNote: async (id) => {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM notes WHERE id = ?', [id]);
    set({ notes: get().notes.filter(n => n.id !== id) });
    ftsRemove(id);
  },

  // ── Inbox ──

  loadInbox: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ id: string; text: string; triaged: number; triage_result: string | null; created_at: string }>(
      'SELECT * FROM inbox_items ORDER BY created_at DESC LIMIT 100'
    );
    set({ inboxItems: rows.map(r => ({ ...r, triaged: !!r.triaged })) });
  },

  addInboxItem: async (text) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      'INSERT INTO inbox_items (id, text, triaged, created_at) VALUES (?, ?, 0, ?)',
      [id, text, now]
    );
    const item: InboxItem = { id, text, triaged: false, triage_result: null, created_at: now };
    set({ inboxItems: [item, ...get().inboxItems] });
  },

  triageInboxItem: async (id, result) => {
    const db = await getDatabase();
    await db.runAsync('UPDATE inbox_items SET triaged = 1, triage_result = ? WHERE id = ?', [result, id]);
    set({ inboxItems: get().inboxItems.map(i => i.id === id ? { ...i, triaged: true, triage_result: result } : i) });
  },

  deleteInboxItem: async (id) => {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM inbox_items WHERE id = ?', [id]);
    set({ inboxItems: get().inboxItems.filter(i => i.id !== id) });
  },

  // ── Time Blocks ──

  loadTimeBlocks: async (date) => {
    const db = await getDatabase();
    const d = date ?? dayjs().format('YYYY-MM-DD');
    const rows = await db.getAllAsync<TimeBlock>(
      'SELECT * FROM time_blocks WHERE date = ? ORDER BY start_time ASC',
      [d]
    );
    set({ timeBlocks: rows });
  },

  addTimeBlock: async (title, startTime, endTime, date, source = 'manual', taskId, color = '#5a8f86') => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      'INSERT INTO time_blocks (id, title, start_time, end_time, source, task_id, color, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, title, startTime, endTime, source, taskId ?? null, color, date, now]
    );
    const block: TimeBlock = { id, title, start_time: startTime, end_time: endTime, source, task_id: taskId ?? null, color, date, created_at: now };
    set({ timeBlocks: [...get().timeBlocks, block].sort((a, b) => a.start_time.localeCompare(b.start_time)) });
  },

  updateTimeBlock: async (id, fields) => {
    const db = await getDatabase();
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (k !== 'id' && k !== 'created_at') {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    if (sets.length === 0) return;
    vals.push(id);
    await db.runAsync(`UPDATE time_blocks SET ${sets.join(', ')} WHERE id = ?`, vals as string[]);
    set({ timeBlocks: get().timeBlocks.map(b => b.id === id ? { ...b, ...fields } : b) });
  },

  deleteTimeBlock: async (id) => {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM time_blocks WHERE id = ?', [id]);
    set({ timeBlocks: get().timeBlocks.filter(b => b.id !== id) });
  },

  // ── Expenses ──

  loadExpenses: async () => {
    const db = await getDatabase();
    const monthStart = dayjs().startOf('month').format('YYYY-MM-DD');
    const todayStr = dayjs().format('YYYY-MM-DD');
    const rows = await db.getAllAsync<Expense>(
      'SELECT * FROM expenses WHERE date >= ? ORDER BY date DESC',
      [monthStart]
    );
    const todaySpend = rows.filter(e => e.date === todayStr).reduce((s, e) => s + e.amount, 0);
    const monthSpend = rows.reduce((s, e) => s + e.amount, 0);
    set({ expenses: rows, todaySpend, monthSpend });
  },

  addExpense: async (amount, category, description, date) => {
    const db = await getDatabase();
    const id = uid();
    const d = date ?? dayjs().format('YYYY-MM-DD');
    const now = dayjs().toISOString();
    await db.runAsync(
      'INSERT INTO expenses (id, amount, category, description, date, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, amount, category, description ?? null, d, now]
    );
    const expense: Expense = { id, amount, currency: 'USD', category, description: description ?? null, date: d, created_at: now };
    const todayStr = dayjs().format('YYYY-MM-DD');
    set({
      expenses: [expense, ...get().expenses],
      todaySpend: d === todayStr ? get().todaySpend + amount : get().todaySpend,
      monthSpend: get().monthSpend + amount,
    });
    ftsIndex('expense', id, description ?? '', `${amount}`, category, d);
  },

  deleteExpense: async (id) => {
    const db = await getDatabase();
    const expense = get().expenses.find(e => e.id === id);
    await db.runAsync('DELETE FROM expenses WHERE id = ?', [id]);
    const todayStr = dayjs().format('YYYY-MM-DD');
    set({
      expenses: get().expenses.filter(e => e.id !== id),
      todaySpend: expense && expense.date === todayStr ? get().todaySpend - expense.amount : get().todaySpend,
      monthSpend: expense ? get().monthSpend - expense.amount : get().monthSpend,
    });
    ftsRemove(id);
  },

  loadBudgets: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<Budget>('SELECT * FROM budgets');
    set({ budgets: rows });
  },

  setBudget: async (category, monthlyLimit) => {
    const db = await getDatabase();
    const existing = get().budgets.find(b => b.category === category);
    if (existing) {
      await db.runAsync('UPDATE budgets SET monthly_limit = ? WHERE id = ?', [monthlyLimit, existing.id]);
      set({ budgets: get().budgets.map(b => b.id === existing.id ? { ...b, monthly_limit: monthlyLimit } : b) });
    } else {
      const id = uid();
      const now = dayjs().toISOString();
      await db.runAsync(
        'INSERT INTO budgets (id, category, monthly_limit, created_at) VALUES (?, ?, ?, ?)',
        [id, category, monthlyLimit, now]
      );
      set({ budgets: [...get().budgets, { id, category, monthly_limit: monthlyLimit, currency: 'USD', created_at: now }] });
    }
  },

  // ── AI Memory ──
  addAiMemory: async (fact, category = 'general', sourceCmdId, expiresAt) => {
    // Dedup: skip if an identical fact already exists
    const existing = get().aiMemories;
    const normalized = fact.toLowerCase().trim();
    if (existing.some(m => m.fact.toLowerCase().trim() === normalized)) return;

    const db = await getDatabase();
    const id = uid();
    await db.runAsync(
      'INSERT INTO ai_memory (id, fact, category, source_cmd_id, expires_at) VALUES (?,?,?,?,?)',
      [id, fact, category, sourceCmdId ?? null, expiresAt ?? null]
    );
    const mem: AiMemory = {
      id, fact, category, source_cmd_id: sourceCmdId ?? null,
      created_at: dayjs().toISOString(), expires_at: expiresAt ?? null,
    };
    const updated = [mem, ...existing];

    // Hard cap: keep only 100 most recent, prune oldest from DB
    if (updated.length > 100) {
      const toDelete = updated.splice(100);
      const ids = toDelete.map(m => `'${m.id}'`).join(',');
      db.runAsync(`DELETE FROM ai_memory WHERE id IN (${ids})`).catch(() => {});
    }

    set({ aiMemories: updated });
    ftsIndex('memory', id, fact, '', category, dayjs().toISOString());
  },

  deleteAiMemory: async (id) => {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM ai_memory WHERE id = ?', [id]);
    set({ aiMemories: get().aiMemories.filter(m => m.id !== id) });
    ftsRemove(id);
  },

  updateAiMemory: async (id, fact) => {
    const db = await getDatabase();
    await db.runAsync('UPDATE ai_memory SET fact = ? WHERE id = ?', [fact, id]);
    set({ aiMemories: get().aiMemories.map(m => m.id === id ? { ...m, fact } : m) });
    ftsIndex('memory', id, fact, '', 'general', dayjs().toISOString());
  },

  loadAiMemories: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<AiMemory>(
      "SELECT * FROM ai_memory WHERE expires_at IS NULL OR expires_at > datetime('now') ORDER BY created_at DESC LIMIT 100"
    );
    set({ aiMemories: rows });
  },

  getMemoryFacts: () => {
    return get().aiMemories.map(m => m.fact);
  },

  setCheckinIntervalMin: (minutes) => {
    kv.set('proactive_checkin_interval_min', minutes);
    set({ checkinIntervalMin: minutes });
  },

  setProactiveQuietHours: (afterHour, beforeHour) => {
    kv.set('proactive_quiet_after_hour', afterHour);
    kv.set('proactive_quiet_before_hour', beforeHour);
    set({ proactiveQuietAfterHour: afterHour, proactiveQuietBeforeHour: beforeHour });
  },

  loadSeenPackages: () => {
    const raw = kv.getString('seen_notif_packages');
    set({ seenNotifPackages: raw ? JSON.parse(raw) : [] });
  },

  setAllowedNotifPackages: (packages) => {
    kv.set('allowed_notif_packages', JSON.stringify(packages));
    set({ allowedNotifPackages: packages });
    // Update native module filter
    try {
      const mod = require('expo-android-notification-listener-service').default;
      if (packages.length > 0) {
        mod.setAllowedPackages(packages);
      }
    } catch { /* module not available */ }
  },

  // ── Partner ──
  setPartnerStatus: (partnerId, online, lastSeen) => {
    const partners = get().partners;
    const existing = partners.find(p => p.id === partnerId);
    if (existing) {
      set({
        partners: partners.map(p =>
          p.id === partnerId ? { ...p, online, lastSeen } : p
        ),
      });
    } else {
      set({
        partners: [...partners, { id: partnerId, name: `Partner`, online, lastSeen }],
      });
    }
  },

  sendSnippet: async (partnerId, content) => {
    const db = await getDatabase();
    const snippetId = uid();
    const ts = dayjs().toISOString();

    // Write to SQLite first (offline-first)
    await db.runAsync(
      'INSERT INTO partner_snippets (snippet_id, partner_id, content, timestamp, synced) VALUES (?,?,?,?,0)',
      [snippetId, partnerId, content, ts]
    );

    const snippet: PartnerSnippet = {
      snippet_id: snippetId,
      partner_id: partnerId,
      content,
      timestamp: ts,
      synced: false,
    };
    set({ partnerSnippets: [snippet, ...get().partnerSnippets] });

    // Try MQTT publish if connected
    if (get().isOnline) {
      try {
        const { mqttService } = await import('../services/mqtt');
        const published = mqttService.publishSnippet(partnerId, content);
        if (published) {
          await db.runAsync('UPDATE partner_snippets SET synced = 1 WHERE snippet_id = ?', [snippetId]);
          set({
            partnerSnippets: get().partnerSnippets.map(s =>
              s.snippet_id === snippetId ? { ...s, synced: true } : s
            ),
          });
          return;
        }
      } catch { /* fall through to queue */ }
    }

    // Queue for later sync
    await get().enqueueEvent('mqtt_publish', {
      topic: `partner/snippet/${partnerId}`,
      content,
    });
  },

  loadPartnerSnippets: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<PartnerSnippet>(
      'SELECT * FROM partner_snippets ORDER BY timestamp DESC LIMIT 50'
    );
    set({ partnerSnippets: rows.map(s => ({ ...s, synced: !!s.synced })) });
  },

  // ── Google integration ──
  setGoogleConnected: (connected, email) => {
    kv.set('google_connected', connected);
    if (email !== undefined) {
      if (email) kv.set('google_email', email);
      else kv.delete('google_email');
    }
    set({ isGoogleConnected: connected, googleEmail: email ?? (connected ? get().googleEmail : null) });
  },

  syncCalendarEvents: async () => {
    if (get().calendarSyncing) return;
    set({ calendarSyncing: true, lastCalendarError: null });
    try {
      const { googleCalendar } = await import('../services/google-calendar');
      // Fetch 2 weeks so "today", "tomorrow", "week" and newly created events are included
      const result = await googleCalendar.listEvents(
        dayjs().startOf('day').toISOString(),
        dayjs().add(14, 'day').endOf('day').toISOString(),
        100,
      );
      if (!result.ok) {
        set({ calendarSyncing: false, lastCalendarError: result.error ?? 'Calendar sync failed' });
        return;
      }

      const db = await getDatabase();
      const now = dayjs().toISOString();
      const events: CalendarEvent[] = [];

      for (const ev of result.data) {
        const startTime = ev.start.dateTime ?? ev.start.date ?? '';
        const endTime = ev.end.dateTime ?? ev.end.date ?? '';
        const allDay = !ev.start.dateTime;
        await db.runAsync(
          `INSERT OR REPLACE INTO calendar_events (event_id,summary,description,location,start_time,end_time,all_day,status,html_link,google_calendar_id,synced_at,raw_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [ev.id, ev.summary, ev.description ?? null, ev.location ?? null, startTime, endTime, allDay ? 1 : 0, ev.status, ev.htmlLink ?? null, 'primary', now, JSON.stringify(ev)]
        );
        events.push({
          event_id: ev.id, summary: ev.summary, description: ev.description ?? null,
          location: ev.location ?? null, start_time: startTime, end_time: endTime,
          all_day: allDay, status: ev.status, html_link: ev.htmlLink ?? null,
          google_calendar_id: 'primary', synced_at: now,
        });
      }

      set({ calendarEvents: events, calendarSyncing: false, calendarLastSynced: now, lastCalendarError: null });

      // Cache next event for widget
      const upcoming = events
        .filter(e => !e.all_day && dayjs(e.start_time).isAfter(dayjs()))
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
      if (upcoming.length > 0) {
        const next = upcoming[0];
        kv.set('widget_next_event', `${dayjs(next.start_time).format('h:mm A')} ${next.summary}`);
      } else {
        kv.delete('widget_next_event');
      }
    } catch (e) {
      set({ calendarSyncing: false, lastCalendarError: (e as Error).message });
    }
  },

  loadCalendarEvents: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      event_id: string; summary: string; description: string; location: string;
      start_time: string; end_time: string; all_day: number; status: string;
      html_link: string; google_calendar_id: string; synced_at: string;
    }>('SELECT * FROM calendar_events ORDER BY start_time ASC');
    set({
      calendarEvents: rows.map(r => ({
        ...r, all_day: !!r.all_day, description: r.description || null,
        location: r.location || null, html_link: r.html_link || null,
      })),
    });
  },

  addCalendarEvent: async (event) => {
    const { googleCalendar } = await import('../services/google-calendar');
    const result = await googleCalendar.createEvent(event);
    if (!result.ok) return { ok: false, error: result.error ?? 'Failed to create event' };
    await get().syncCalendarEvents();
    return { ok: true };
  },

  updateCalendarEvent: async (eventId, fields) => {
    const { googleCalendar } = await import('../services/google-calendar');
    const result = await googleCalendar.updateEvent(eventId, fields);
    if (result.ok) {
      await get().syncCalendarEvents();
    }
  },

  deleteCalendarEvent: async (eventId) => {
    const { googleCalendar } = await import('../services/google-calendar');
    const result = await googleCalendar.deleteEvent(eventId);
    if (result.ok) {
      const db = await getDatabase();
      await db.runAsync('DELETE FROM calendar_events WHERE event_id = ?', [eventId]);
      set({ calendarEvents: get().calendarEvents.filter(e => e.event_id !== eventId) });
    }
  },

  syncEmails: async () => {
    if (get().emailSyncing) return;
    set({ emailSyncing: true, lastEmailError: null });
    try {
      const { googleGmail } = await import('../services/google-gmail');
      const listResult = await googleGmail.listMessages('is:unread in:inbox', 20);
      if (!listResult.ok) {
        set({ emailSyncing: false, lastEmailError: listResult.error ?? 'Email sync failed' });
        return;
      }

      const metaResult = await googleGmail.getMessagesMeta(listResult.data);
      if (!metaResult.ok) {
        set({ emailSyncing: false, lastEmailError: metaResult.error ?? 'Email sync failed' });
        return;
      }

      const db = await getDatabase();
      const now = dayjs().toISOString();
      const cached: CachedEmail[] = [];

      for (const meta of metaResult.data) {
        await db.runAsync(
          `INSERT OR REPLACE INTO email_cache (message_id,thread_id,from_address,subject,snippet,date,is_unread,is_starred,label_ids,synced_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [meta.id, meta.threadId, meta.from, meta.subject, meta.snippet, meta.date, meta.isUnread ? 1 : 0, meta.isStarred ? 1 : 0, JSON.stringify(meta.labelIds), now]
        );
        cached.push({
          message_id: meta.id, thread_id: meta.threadId,
          from_address: meta.from, subject: meta.subject,
          snippet: meta.snippet, date: meta.date,
          is_unread: meta.isUnread, is_starred: meta.isStarred,
          label_ids: meta.labelIds, category: null, extracted_tasks: [],
        });
      }

      set({
        emails: cached,
        emailSyncing: false,
        emailLastSynced: now,
        lastEmailError: null,
        unreadEmailCount: cached.filter(e => e.is_unread).length,
      });
    } catch (e) {
      set({ emailSyncing: false, lastEmailError: (e as Error).message });
    }
  },

  loadEmails: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      message_id: string; thread_id: string; from_address: string; subject: string;
      snippet: string; date: string; is_unread: number; is_starred: number;
      label_ids: string; body_text: string;
    }>('SELECT * FROM email_cache ORDER BY date DESC LIMIT 50');
    const catRows = await db.getAllAsync<{
      message_id: string; category: string; extracted_tasks: string;
    }>('SELECT * FROM email_categories');
    const catMap = new Map(catRows.map(r => [r.message_id, r]));
    const emails: CachedEmail[] = rows.map(r => {
      const cat = catMap.get(r.message_id);
      return {
        message_id: r.message_id, thread_id: r.thread_id,
        from_address: r.from_address, subject: r.subject,
        snippet: r.snippet || '', date: r.date,
        is_unread: !!r.is_unread, is_starred: !!r.is_starred,
        label_ids: r.label_ids ? JSON.parse(r.label_ids) : [],
        category: (cat?.category as CachedEmail['category']) ?? null,
        extracted_tasks: cat?.extracted_tasks ? JSON.parse(cat.extracted_tasks) : [],
      };
    });
    set({ emails, unreadEmailCount: emails.filter(e => e.is_unread).length });
  },

  triageEmails: async () => {
    const { categorizeEmail } = await import('../services/google-gmail');
    const db = await getDatabase();
    const now = dayjs().toISOString();
    const updated = get().emails.map(email => {
      const category = categorizeEmail({
        id: email.message_id, threadId: email.thread_id, snippet: email.snippet,
        from: email.from_address, subject: email.subject, date: email.date,
        isUnread: email.is_unread, isStarred: email.is_starred, labelIds: email.label_ids,
      });
      return { ...email, category };
    });

    for (const email of updated) {
      if (email.category) {
        await db.runAsync(
          `INSERT OR REPLACE INTO email_categories (message_id,category,extracted_tasks,categorized_at) VALUES (?,?,?,?)`,
          [email.message_id, email.category, JSON.stringify(email.extracted_tasks), now]
        );
      }
    }
    set({ emails: updated });
  },

  markEmailRead: async (messageId) => {
    const { googleGmail } = await import('../services/google-gmail');
    const result = await googleGmail.markAsRead(messageId);
    if (result.ok) {
      const db = await getDatabase();
      await db.runAsync('UPDATE email_cache SET is_unread = 0 WHERE message_id = ?', [messageId]);
      const emails = get().emails.map(e =>
        e.message_id === messageId ? { ...e, is_unread: false } : e
      );
      set({ emails, unreadEmailCount: emails.filter(e => e.is_unread).length });
    }
  },

  toggleEmailStar: async (messageId, starred) => {
    const { googleGmail } = await import('../services/google-gmail');
    const result = await googleGmail.toggleStar(messageId, starred);
    if (result.ok) {
      const db = await getDatabase();
      await db.runAsync('UPDATE email_cache SET is_starred = ? WHERE message_id = ?', [starred ? 1 : 0, messageId]);
      set({
        emails: get().emails.map(e =>
          e.message_id === messageId ? { ...e, is_starred: starred } : e
        ),
      });
    }
  },

  extractTasksFromEmails: async () => {
    const { extractTasksFromEmail } = await import('../services/google-gmail');
    const { googleGmail } = await import('../services/google-gmail');
    const db = await getDatabase();
    const now = dayjs().toISOString();
    const actionEmails = get().emails.filter(e => e.category === 'action_needed' || e.category === 'important');
    const allTasks: string[] = [];

    for (const email of actionEmails.slice(0, 5)) {
      const bodyResult = await googleGmail.getMessageBody(email.message_id);
      const bodyText = bodyResult.ok ? bodyResult.data : email.snippet;
      const tasks = extractTasksFromEmail(email.subject, bodyText);
      if (tasks.length > 0) {
        allTasks.push(...tasks);
        const updated = { ...email, extracted_tasks: tasks };
        await db.runAsync(
          `INSERT OR REPLACE INTO email_categories (message_id,category,extracted_tasks,categorized_at) VALUES (?,?,?,?)`,
          [email.message_id, email.category ?? 'fyi', JSON.stringify(tasks), now]
        );
        set({
          emails: get().emails.map(e =>
            e.message_id === email.message_id ? updated : e
          ),
        });
      }
    }

    // Create tasks from extracted items
    for (const taskTitle of [...new Set(allTasks)].slice(0, 10)) {
      await get().addTask(taskTitle, 'medium', null, 'Extracted from email');
    }

    return allTasks;
  },

  // ── PicoClaw — Routines ──
  loadRoutines: async () => {
    const db = await getDatabase();
    const { parseRoutineRow } = await import('../agent/routines');
    const rows = await db.getAllAsync<{
      id: string; name: string; trigger_phrases: string; steps: string; enabled: number; created_at: string;
    }>('SELECT * FROM routines WHERE enabled = 1');
    set({ routines: rows.map(parseRoutineRow) });
  },

  addRoutine: async (name, triggerPhrases, steps) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      'INSERT INTO routines (id, name, trigger_phrases, steps, enabled, created_at) VALUES (?,?,?,?,1,?)',
      [id, name, JSON.stringify(triggerPhrases), JSON.stringify(steps), now]
    );
    const routine = { id, name, triggerPhrases, steps, enabled: true, createdAt: now };
    set({ routines: [...get().routines, routine] });
  },

  deleteRoutine: async (id) => {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM routines WHERE id = ?', [id]);
    set({ routines: get().routines.filter(r => r.id !== id) });
  },

  // ── PicoClaw — Automation Rules ──
  loadAutomationRules: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      id: string; name: string; description: string; rule_type: string; schedule: string;
      condition: string; actions: string; enabled: number; last_triggered: string; created_at: string;
    }>('SELECT * FROM automation_rules');
    set({
      automationRules: rows.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description || '',
        ruleType: r.rule_type as 'schedule' | 'condition',
        schedule: r.schedule || null,
        condition: r.condition || null,
        actions: JSON.parse(r.actions),
        enabled: !!r.enabled,
        lastTriggered: r.last_triggered || null,
        createdAt: r.created_at,
      })),
    });
  },

  addAutomationRule: async (rule) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      'INSERT INTO automation_rules (id,name,description,rule_type,schedule,condition,actions,enabled,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, rule.name, rule.description, rule.ruleType, rule.schedule ?? null, rule.condition ?? null, JSON.stringify(rule.actions), rule.enabled ? 1 : 0, now]
    );
    set({
      automationRules: [...get().automationRules, { ...rule, id, createdAt: now, lastTriggered: null }],
    });
  },

  updateAutomationRule: async (id, fields) => {
    const db = await getDatabase();
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.name !== undefined) { sets.push('name = ?'); vals.push(fields.name); }
    if (fields.description !== undefined) { sets.push('description = ?'); vals.push(fields.description); }
    if (fields.schedule !== undefined) { sets.push('schedule = ?'); vals.push(fields.schedule); }
    if (fields.condition !== undefined) { sets.push('condition = ?'); vals.push(fields.condition); }
    if (fields.actions !== undefined) { sets.push('actions = ?'); vals.push(JSON.stringify(fields.actions)); }
    if (fields.enabled !== undefined) { sets.push('enabled = ?'); vals.push(fields.enabled ? 1 : 0); }
    if (fields.lastTriggered !== undefined) { sets.push('last_triggered = ?'); vals.push(fields.lastTriggered); }
    if (sets.length === 0) return;
    vals.push(id);
    await db.runAsync(`UPDATE automation_rules SET ${sets.join(', ')} WHERE id = ?`, vals as string[]);
    set({
      automationRules: get().automationRules.map(r =>
        r.id === id ? { ...r, ...fields } : r
      ),
    });
  },

  deleteAutomationRule: async (id) => {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM automation_rules WHERE id = ?', [id]);
    set({ automationRules: get().automationRules.filter(r => r.id !== id) });
  },
}));
