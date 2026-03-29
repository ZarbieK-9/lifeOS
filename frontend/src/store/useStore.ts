// Zustand store — CONTEXT.md: "zustand (offline-first state management)"
// Central app state. MMKV for sync reads, SQLite for persistence.

import dayjs from "dayjs";
import { create } from "zustand";
import { getDatabase, uid } from "../db/database";
import { kv } from "../db/mmkv";
import type { DownloadProgress, ModelStatus } from "../llm/types";

// ── FTS5 search index sync (fire-and-forget) ─────────
// Lazy import to avoid circular deps; errors are swallowed silently.
function ftsIndex(
  type: "task" | "note" | "memory" | "expense" | "habit" | "goal",
  id: string,
  title: string,
  body: string,
  category: string,
  date: string,
) {
  import("../db/search")
    .then((m) => m.indexItem(type, id, title, body, category, date))
    .catch((e) => console.warn(`[FTS] index failed for ${type}/${id}:`, e));
}
function ftsRemove(id: string) {
  import("../db/search").then((m) => m.removeFromIndex(id)).catch(() => {});
}

// ── Types ──────────────────────────────────────────

export interface Task {
  task_id: string;
  title: string;
  due_date: string | null;
  priority: "low" | "medium" | "high";
  notes: string;
  status: "pending" | "completed" | "overdue";
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
  status: "pending" | "executed" | "queued" | "failed";
  source:
    | "user"
    | "morning"
    | "checkin"
    | "evening"
    | "calendar_alert"
    | "calendar_gap"
    | "email_alert"
    | "notification_alert";
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
  category: "important" | "action_needed" | "fyi" | "newsletter" | null;
  extracted_tasks: string[];
}

export interface MoodLog {
  id: string;
  mood: number; // 1-5
  energy: number; // 1-5
  note: string | null;
  logged_at: string;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  category: "note" | "journal";
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
  source: "manual" | "calendar" | "ai";
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

export interface UserProfile {
  id: string;
  weight_kg: number | null;
  height_cm: number | null;
  birth_date: string | null;
  gender: string | null;
  activity_level: string | null;
  target_weight_kg: number | null;
  target_date: string | null;
  goal_type: string | null;
  /** Free text: what a normal weekday looks like */
  day_outline: string | null;
  /** Activities the user wants to protect (walk, gym, reading, …) */
  activity_prefs: string | null;
  /** HH:mm (24h) — typical wake */
  typical_wake_time: string | null;
  /** HH:mm — aim to leave home (commute / office) */
  leave_home_time: string | null;
  /** HH:mm — be at work / first commitment */
  work_start_time: string | null;
  /** HH:mm — target bedtime */
  typical_bedtime: string | null;
  /** Coach + playful nudges use this profile */
  day_coach_enabled: number | null;
  created_at: string;
  updated_at: string;
}

export interface WeightLog {
  id: string;
  date: string;
  weight_kg: number;
  created_at: string;
}

// ── Agent types (re-exported for convenience) ──────
export type {
    AutomationRule, Reminder, Routine, SleepSession
} from "../agent/types";
export type {
    Goal, Plan, PlanStep, AgentAction, BehaviorPattern, AgentInsight, WatcherNotification,
    GoalDomain, GoalStatus, PlanStatus, CoachingCommitment,
} from "../agent/types";

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
  sleepSessions: import("../agent/types").SleepSession[];
  hydrationLast7Days: { days: string[]; values: number[] } | null;
  sleepLast7Days: { days: string[]; values: number[] } | null;

  // Reminders
  reminders: import("../agent/types").Reminder[];

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
  // Agent governance and policy
  agentDefaultApprovalMode: "auto" | "ask_first" | "suggest_only";
  agentDomainApprovalModes: Record<string, "auto" | "ask_first" | "suggest_only">;
  agentPendingApprovals: Array<{
    id: string;
    tool: string;
    params: Record<string, unknown>;
    source: "plan" | "watcher" | "voice";
    created_at: string;
  }>;
  agentPolicy: {
    neverAutoSendMessages: boolean;
    neverScheduleBeforeHour: number;
    maxDailySpendAuto: number;
  };
  // Location and simulation
  locationContextEnabled: boolean;
  lastKnownLocation: { lat: number; lng: number; ts: string } | null;
  geofencePlaces: Array<{ id: string; name: string; lat: number; lng: number; radius_m: number; reminder_text: string }>;
  simulationMode: boolean;
  // Hey Zarbie (Android wake-word assistant)
  heyZarbieEnabled: boolean;
  heyZarbieOnlyWhenCharging: boolean;
  heyZarbiePauseOnLowBattery: boolean;
  heyZarbieSensitivity: "low" | "balanced" | "high";
  heyZarbieLaunchBehavior: "popup" | "open_ai_tab";
  heyZarbieConsentGranted: boolean;
  // Memory tiers
  ephemeralMemories: string[];
  /** Always true on Android — notification listener is non-negotiable. */
  notificationListenerEnabled: boolean;
  seenNotifPackages: Array<{ packageName: string; appName: string }>;
  allowedNotifPackages: string[];

  // Partner
  partners: Partner[];
  partnerSnippets: PartnerSnippet[];

  // PicoClaw agent — routines & automation
  routines: import("../agent/types").Routine[];
  automationRules: import("../agent/types").AutomationRule[];

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
  /** Outlook / Microsoft 365 calendar (Graph) — optional second source */
  isMicrosoftConnected: boolean;
  microsoftEmail: string | null;
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
  scoreBreakdown: {
    hydration: number;
    tasks: number;
    sleep: number;
    habits: number;
  };

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

  // Me profile
  userProfile: UserProfile | null;
  weightLogs: WeightLog[];

  // Streak & Habit actions
  updateDailyStreak: () => Promise<void>;
  loadHabits: () => Promise<void>;
  addHabit: (
    name: string,
    icon?: string,
    targetPerDay?: number,
    unit?: string | null,
  ) => Promise<string>;
  logHabitEntry: (habitId: string, value?: number) => Promise<void>;
  deleteHabit: (habitId: string) => Promise<void>;
  getHabitStats: (habitId: string) => {
    currentStreak: number;
    bestStreak: number;
    weeklyCount: number;
    totalLogged: number;
    last30Days: { date: string; count: number }[];
  };

  // Mood actions
  loadMoodLogs: () => Promise<void>;
  addMoodLog: (mood: number, energy: number, note?: string) => Promise<void>;

  // Notes actions
  loadNotes: () => Promise<void>;
  addNote: (
    title: string,
    body?: string,
    category?: "note" | "journal",
  ) => Promise<string>;
  updateNote: (id: string, fields: Partial<Note>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;

  // Inbox actions
  loadInbox: () => Promise<void>;
  addInboxItem: (text: string) => Promise<void>;
  triageInboxItem: (id: string, result: string) => Promise<void>;
  deleteInboxItem: (id: string) => Promise<void>;

  // Time Block actions
  loadTimeBlocks: (date?: string) => Promise<void>;
  addTimeBlock: (
    title: string,
    startTime: string,
    endTime: string,
    date: string,
    source?: "manual" | "calendar" | "ai",
    taskId?: string,
    color?: string,
  ) => Promise<void>;
  updateTimeBlock: (id: string, fields: Partial<TimeBlock>) => Promise<void>;
  deleteTimeBlock: (id: string) => Promise<void>;

  // Expense actions
  loadExpenses: () => Promise<void>;
  addExpense: (
    amount: number,
    category: string,
    description?: string,
    date?: string,
  ) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  loadBudgets: () => Promise<void>;
  setBudget: (category: string, monthlyLimit: number) => Promise<void>;

  // Me profile actions
  setUserProfile: (partial: Partial<UserProfile>) => void;
  saveUserProfile: () => Promise<void>;
  addWeightLog: (date: string, weightKg: number) => Promise<void>;
  loadUserProfile: () => Promise<void>;

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
  setHydrationReminder: (
    startHour: number,
    endHour: number,
    goalMl: number,
    intervalMin?: number,
  ) => void;
  disableHydrationReminder: () => void;
  skipHydrationDose: (ml: number) => void;
  clearSkippedDose: () => void;
  advanceHydrationReminder: () => void;
  recalculateHydrationSchedule: () => void;

  // Sleep sessions
  addSleepSession: (
    start: string,
    end: string,
    durationMin: number,
  ) => Promise<void>;
  deleteSleepSession: (sessionId: string) => Promise<void>;
  loadSleepSessions: (period?: "today" | "week") => Promise<void>;
  loadLast7Days: () => Promise<void>;

  // Reminders
  addReminder: (text: string, triggerAt: string) => Promise<void>;
  loadReminders: () => Promise<void>;

  addTask: (
    title: string,
    priority?: Task["priority"],
    dueDate?: string | null,
    notes?: string,
    recurrence?: string | null,
  ) => Promise<void>;
  updateTask: (taskId: string, fields: Partial<Task>) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  loadTasks: () => Promise<void>;

  enqueueEvent: (
    type: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  loadQueue: () => Promise<void>;
  drainQueue: () => Promise<void>;
  pullServerData: () => Promise<void>;

  addChatSession: () => Promise<string>;
  setCurrentChat: (chatId: string | null) => void;
  loadChatSessions: () => Promise<void>;
  loadAiCommandsForChat: (chatId: string) => Promise<void>;
  addAiCommand: (
    input: string,
    source?: AiCommand["source"],
  ) => Promise<string>;
  resolveAiCommand: (
    id: string,
    output: string,
    status: AiCommand["status"],
  ) => Promise<void>;
  loadAiCommands: () => Promise<void>;
  updateChatTitle: (chatId: string, title: string) => Promise<void>;
  deleteChatSession: (chatId: string) => Promise<void>;

  // AI Memory
  addAiMemory: (
    fact: string,
    category?: string,
    sourceCmdId?: string,
    expiresAt?: string,
    tier?: "persistent" | "ephemeral",
  ) => Promise<void>;
  deleteAiMemory: (id: string) => Promise<void>;
  updateAiMemory: (id: string, fact: string) => Promise<void>;
  loadAiMemories: () => Promise<void>;
  getMemoryFacts: () => string[];
  setCheckinIntervalMin: (minutes: number) => void;
  setProactiveQuietHours: (afterHour: number, beforeHour: number) => void;
  loadSeenPackages: () => void;
  setAllowedNotifPackages: (packages: string[]) => void;
  promoteEphemeralMemory: (fact: string, category?: string) => Promise<void>;
  clearEphemeralMemories: () => void;
  setApprovalMode: (mode: "auto" | "ask_first" | "suggest_only", domain?: string) => void;
  enqueueAgentApproval: (tool: string, params: Record<string, unknown>, source: "plan" | "watcher" | "voice") => Promise<string>;
  resolveAgentApproval: (id: string, approved: boolean) => Promise<{ ok: boolean; message: string }>;
  setAgentPolicy: (partial: Partial<AppState["agentPolicy"]>) => void;
  setSimulationMode: (enabled: boolean) => void;
  setHeyZarbieConfig: (partial: {
    enabled?: boolean;
    onlyWhenCharging?: boolean;
    pauseOnLowBattery?: boolean;
    sensitivity?: "low" | "balanced" | "high";
    launchBehavior?: "popup" | "open_ai_tab";
  }) => void;
  setHeyZarbieConsent: (granted: boolean) => void;
  setLocationContext: (enabled: boolean) => void;
  updateLastKnownLocation: (lat: number, lng: number) => void;
  upsertGeofencePlace: (place: { id?: string; name: string; lat: number; lng: number; radius_m?: number; reminder_text: string }) => void;
  removeGeofencePlace: (id: string) => void;

  // Partner
  setPartnerStatus: (
    partnerId: string,
    online: boolean,
    lastSeen: string,
  ) => void;
  sendSnippet: (partnerId: string, content: string) => Promise<void>;
  loadPartnerSnippets: () => Promise<void>;

  // Google integration
  setGoogleConnected: (connected: boolean, email?: string | null) => void;
  setMicrosoftConnected: (connected: boolean, email?: string | null) => void;
  syncCalendarEvents: () => Promise<void>;
  syncMicrosoftCalendarEvents: () => Promise<void>;
  loadCalendarEvents: () => Promise<void>;
  addCalendarEvent: (event: {
    summary: string;
    startDateTime: string;
    endDateTime: string;
    description?: string;
    location?: string;
    timeZone?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  updateCalendarEvent: (
    eventId: string,
    fields: {
      summary?: string;
      startDateTime?: string;
      endDateTime?: string;
      description?: string;
      location?: string;
      timeZone?: string;
    },
  ) => Promise<void>;
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
  addRoutine: (
    name: string,
    triggerPhrases: string[],
    steps: import("../agent/types").RoutineStep[],
  ) => Promise<void>;
  deleteRoutine: (id: string) => Promise<void>;

  // PicoClaw — Automation Rules CRUD
  loadAutomationRules: () => Promise<void>;
  addAutomationRule: (
    rule: Omit<
      import("../agent/types").AutomationRule,
      "id" | "createdAt" | "lastTriggered"
    >,
  ) => Promise<void>;
  updateAutomationRule: (
    id: string,
    fields: Partial<import("../agent/types").AutomationRule>,
  ) => Promise<void>;
  deleteAutomationRule: (id: string) => Promise<void>;

  // ── Agentic system ─────────────────────────────────
  goals: import("../agent/types").Goal[];
  plans: import("../agent/types").Plan[];
  agentActions: import("../agent/types").AgentAction[];
  patterns: import("../agent/types").BehaviorPattern[];
  watcherQueue: import("../agent/types").WatcherNotification[];
  coachingCommitments: import("../agent/types").CoachingCommitment[];

  // Goal CRUD
  loadGoals: () => Promise<void>;
  addGoal: (goal: Omit<import("../agent/types").Goal, "id" | "createdAt" | "updatedAt" | "currentValue" | "status">) => Promise<string>;
  updateGoal: (id: string, fields: Partial<import("../agent/types").Goal>) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  progressGoal: (id: string, value: number) => Promise<void>;

  // Plan CRUD
  loadPlans: () => Promise<void>;
  addPlan: (plan: Omit<import("../agent/types").Plan, "id" | "createdAt" | "updatedAt" | "status">) => Promise<string>;
  updatePlan: (id: string, fields: Partial<import("../agent/types").Plan>) => Promise<void>;
  updatePlanStep: (planId: string, stepId: string, status: import("../agent/types").StepStatus) => Promise<void>;

  // Agent actions log
  logAgentAction: (action: Omit<import("../agent/types").AgentAction, "id" | "createdAt">) => Promise<void>;

  // Patterns
  loadPatterns: () => Promise<void>;
  upsertPattern: (pattern: Omit<import("../agent/types").BehaviorPattern, "id" | "createdAt">) => Promise<void>;

  // Watcher queue
  loadWatcherQueue: () => Promise<void>;
  addWatcherNotification: (
    n: Omit<import("../agent/types").WatcherNotification, "id" | "createdAt" | "read"> & {
      id?: string;
      ruleId?: string;
    },
  ) => Promise<void>;
  markWatcherRead: (id: string) => Promise<void>;
  markRecentWatcherActed: (withinMinutes?: number) => Promise<void>;
  executeWatcherSuggestedAction: (id: string) => Promise<{ ok: boolean; message: string }>;
  clearWatcherQueue: () => Promise<void>;
  /** Enqueue device IANA TZ when it changes (server coach windows). */
  syncUserCoachTimezoneToServer: () => Promise<void>;
  /** Pull server coach_notifications + canonical commitments when logged in with server coach. */
  syncServerCoachState: () => Promise<void>;

  // Coaching commitments
  loadCoachingCommitments: () => Promise<void>;
  addCoachingCommitment: (
    row: Omit<import("../agent/types").CoachingCommitment, "id" | "createdAt" | "adopted"> & { adopted?: boolean },
  ) => Promise<string>;
  setCoachingCommitmentAdopted: (id: string, adopted: boolean, outcome?: string | null) => Promise<void>;
}

let _initPromise: Promise<void> | null = null;

async function syncCoachingCommitmentToServer(
  c: import("../agent/types").CoachingCommitment,
): Promise<void> {
  try {
    if (!kv.getString("backend_url") || kv.getString("server_coach_enabled") !== "1") return;
    const { api } = await import("../services/api");
    if (!(await api.isAuthenticated())) return;
    await api.upsertCoachingCommitments([
      {
        id: c.id,
        suggestion: c.suggestion,
        reason: c.reason ?? undefined,
        date_suggested: c.dateSuggested,
        date_due: c.dateDue ?? undefined,
        adopted: c.adopted,
        outcome: c.outcome ?? undefined,
        created_at: c.createdAt,
      },
    ]);
  } catch {
    /* offline / best-effort */
  }
}

// Seed backend URL from .env if not already set in MMKV
const ENV_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
if (ENV_BACKEND_URL && !kv.getString("backend_url")) {
  kv.set("backend_url", ENV_BACKEND_URL.replace(/\/+$/, ""));
}

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  isOnline: true,
  isBackendConfigured: !!kv.getString("backend_url") || !!ENV_BACKEND_URL,
  isAuthenticated: !!kv.getString("user_id"),

  sleep: kv.getJSON<SleepState>("sleep") ?? {
    isAsleep: false,
    sleepStart: null,
    sleepEnd: null,
    durationMinutes: 0,
  },

  hydrationTodayMl: kv.getNumber("hydration_today"),
  hydrationLogs: [],

  focusEnabled: kv.getBool("focus_enabled"),
  focusStartedAt: kv.getString("focus_started"),
  focusDurationMin: kv.getNumber("focus_duration") || 45,
  focusRemainingMin: kv.getNumber("focus_remaining"),

  tasks: [],
  sleepSessions: [],
  hydrationLast7Days: null,
  sleepLast7Days: null,
  reminders: [],
  queueCount: kv.getNumber("queue_count"),
  queuedEvents: [],
  chatSessions: [],
  currentChatId: kv.getString("current_chat_id") || null,
  aiCommands: [],
  aiMemories: [],
  proactiveAIEnabled: true as const,
  checkinIntervalMin: kv.getNumber("proactive_checkin_interval_min") || 90,
  proactiveQuietAfterHour: kv.getNumber("proactive_quiet_after_hour") ?? 21,
  proactiveQuietBeforeHour: kv.getNumber("proactive_quiet_before_hour") ?? 7,
  agentDefaultApprovalMode:
    (kv.getString("agent_approval_default") as "auto" | "ask_first" | "suggest_only") ??
    "ask_first",
  agentDomainApprovalModes: kv.getJSON<Record<string, "auto" | "ask_first" | "suggest_only">>(
    "agent_approval_domains",
  ) ?? {},
  agentPendingApprovals: [],
  agentPolicy: kv.getJSON<{
    neverAutoSendMessages: boolean;
    neverScheduleBeforeHour: number;
    maxDailySpendAuto: number;
  }>("agent_policy") ?? {
    neverAutoSendMessages: true,
    neverScheduleBeforeHour: 8,
    maxDailySpendAuto: 25,
  },
  locationContextEnabled: (kv.getBool("location_context_enabled") ?? false),
  lastKnownLocation: kv.getJSON<{ lat: number; lng: number; ts: string }>("last_known_location") ?? null,
  geofencePlaces: kv.getJSON<Array<{ id: string; name: string; lat: number; lng: number; radius_m: number; reminder_text: string }>>("geofence_places") ?? [],
  simulationMode: kv.getBool("agent_simulation_mode") ?? false,
  heyZarbieEnabled: kv.getBool("hey_zarbie_enabled") ?? false,
  heyZarbieOnlyWhenCharging: kv.getBool("hey_zarbie_only_charging") ?? false,
  heyZarbiePauseOnLowBattery: kv.getBool("hey_zarbie_pause_low_battery") ?? true,
  heyZarbieSensitivity:
    (kv.getString("hey_zarbie_sensitivity") as "low" | "balanced" | "high") ??
    "balanced",
  heyZarbieLaunchBehavior:
    (kv.getString("hey_zarbie_launch_behavior") as "popup" | "open_ai_tab") ??
    "popup",
  heyZarbieConsentGranted: kv.getBool("hey_zarbie_consent_granted") ?? false,
  ephemeralMemories: [],
  notificationListenerEnabled: true,
  seenNotifPackages: JSON.parse(kv.getString("seen_notif_packages") || "[]"),
  allowedNotifPackages: JSON.parse(
    kv.getString("allowed_notif_packages") || "[]",
  ),
  partners: [],
  partnerSnippets: [],
  routines: [],
  automationRules: [],

  autoMorningEnabled: kv.getBool("auto_morning_enabled") ?? true,
  autoNightEnabled: kv.getBool("auto_night_enabled") ?? true,

  hydrationReminderEnabled: kv.getBool("hydration_reminder_enabled"),
  hydrationStartHour: kv.getNumber("hydration_start_hour") || 8,
  hydrationEndHour: kv.getNumber("hydration_end_hour") || 22,
  hydrationGoalMl: kv.getNumber("hydration_goal_ml") || 2500,
  hydrationIntervalMin: kv.getNumber("hydration_interval_min") || 84,
  nextHydrationReminderAt: kv.getString("hydration_next_at") ?? null,
  hydrationDosePerReminder: kv.getNumber("hydration_dose_per") || 250,
  hydrationSkippedMl: kv.getNumber("hydration_skipped_ml"),

  isGoogleConnected: kv.getBool("google_connected"),
  googleEmail: kv.getString("google_email") || null,
  isMicrosoftConnected: kv.getBool("microsoft_connected"),
  microsoftEmail: kv.getString("microsoft_email") || null,
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

  userProfile: null,
  weightLogs: [],

  // On-device LLM — fast model (0.5B)
  llmFastModelStatus: kv.getString("llm_fast_model_path")
    ? "downloaded"
    : ("not_downloaded" as ModelStatus),
  llmFastModelPath: kv.getString("llm_fast_model_path") || null,
  llmFastDownloadProgress: null,

  // On-device LLM — heavy model (3B)
  llmModelStatus: kv.getString("llm_model_path")
    ? "downloaded"
    : ("not_downloaded" as ModelStatus),
  llmModelPath: kv.getString("llm_model_path") || null,
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

        // Restore Google connection: load last known state from DB, then validate tokens (SecureStore) and sync
        try {
          const { loadGoogleOAuthState } = await import("../db/database");
          const dbState = await loadGoogleOAuthState();
          if (dbState) {
            kv.set("google_connected", dbState.connected);
            if (dbState.email != null) kv.set("google_email", dbState.email);
          }
          const { googleAuth } = await import("../services/google-auth");
          await googleAuth.restoreConnection();
        } catch (e) {
          console.log("[LifeOS] Google restore skipped:", e);
        }

        // Restore app settings from DB (morning/sleep summary, proactive quiet hours, check-in interval)
        try {
          const { loadAppSettings } = await import("../db/database");
          const appSettings = await loadAppSettings();
          if (appSettings) {
            kv.set("auto_morning_enabled", appSettings.auto_morning_enabled !== 0);
            kv.set("auto_night_enabled", appSettings.auto_night_enabled !== 0);
            kv.set("proactive_checkin_interval_min", appSettings.proactive_checkin_interval_min);
            kv.set("proactive_quiet_after_hour", appSettings.proactive_quiet_after_hour);
            kv.set("proactive_quiet_before_hour", appSettings.proactive_quiet_before_hour);
            set({
              autoMorningEnabled: appSettings.auto_morning_enabled !== 0,
              autoNightEnabled: appSettings.auto_night_enabled !== 0,
              checkinIntervalMin: appSettings.proactive_checkin_interval_min,
              proactiveQuietAfterHour: appSettings.proactive_quiet_after_hour,
              proactiveQuietBeforeHour: appSettings.proactive_quiet_before_hour,
            });
          }
        } catch (e) {
          console.log("[LifeOS] App settings restore skipped:", e);
        }

        // Tasks
        const tasks = await db.getAllAsync<Task>(
          "SELECT * FROM tasks ORDER BY created_at DESC",
        );

        // Hydration today
        const todayStart = dayjs().startOf("day").toISOString();
        const hydRow = await db.getFirstAsync<{ total: number }>(
          "SELECT COALESCE(SUM(amount_ml),0) as total FROM hydration_logs WHERE timestamp >= ?",
          [todayStart],
        );
        const hydrationTodayMl = hydRow?.total ?? 0;
        kv.set("hydration_today", hydrationTodayMl);

        // Recent hydration logs
        const hydrationLogs = await db.getAllAsync<HydrationLog>(
          "SELECT * FROM hydration_logs WHERE timestamp >= ? ORDER BY timestamp DESC",
          [todayStart],
        );

        // Queue
        const queuedEvents = await db.getAllAsync<QueuedEvent>(
          "SELECT * FROM event_queue WHERE status = 'pending' ORDER BY created_at ASC",
        );

        // Chat sessions (for sidebar)
        const chatSessions = await db.getAllAsync<ChatSession>(
          "SELECT id, title, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT 100",
        );
        const currentChatId =
          kv.getString("current_chat_id") || (chatSessions[0]?.id ?? null);

        // AI commands for current chat only; empty when no chat selected (new chat flow)
        let aiCommands: AiCommand[] = [];
        if (currentChatId) {
          aiCommands = (
            await db.getAllAsync<AiCommand & { source?: string }>(
              "SELECT * FROM ai_commands WHERE chat_id = ? ORDER BY created_at ASC",
              [currentChatId],
            )
          ).map((c) => ({
            ...c,
            chat_id: c.chat_id ?? currentChatId,
            source: (c.source || "user") as AiCommand["source"],
          }));
        }

        // AI memories — load non-expired facts
        const aiMemories = await db.getAllAsync<AiMemory>(
          "SELECT * FROM ai_memory WHERE expires_at IS NULL OR expires_at > datetime('now') ORDER BY created_at DESC LIMIT 100",
        );
        // Clean up expired memories in background
        db.runAsync(
          "DELETE FROM ai_memory WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')",
        ).catch(() => {});

        // Partner snippets
        const partnerSnippets = await db.getAllAsync<PartnerSnippet>(
          "SELECT * FROM partner_snippets ORDER BY timestamp DESC LIMIT 50",
        );

        // Sleep sessions (today)
        const sleepSessions = await db.getAllAsync<
          import("../agent/types").SleepSession
        >(
          "SELECT * FROM sleep_sessions WHERE sleep_start >= ? ORDER BY sleep_start DESC",
          [todayStart],
        );

        // Reminders (unfired)
        const reminderRows = await db.getAllAsync<{
          reminder_id: string;
          text: string;
          trigger_at: string;
          fired: number;
          created_at: string;
        }>("SELECT * FROM reminders WHERE fired = 0 ORDER BY trigger_at ASC");
        const reminders: import("../agent/types").Reminder[] = reminderRows.map(
          (r) => ({
            ...r,
            fired: !!r.fired,
          }),
        );

        // PicoClaw — user routines
        const { parseRoutineRow } = await import("../agent/routines");
        const routineRows = await db.getAllAsync<{
          id: string;
          name: string;
          trigger_phrases: string;
          steps: string;
          enabled: number;
          created_at: string;
        }>("SELECT * FROM routines WHERE enabled = 1");
        const routines = routineRows.map(parseRoutineRow);

        // PicoClaw — automation rules
        const ruleRows = await db.getAllAsync<{
          id: string;
          name: string;
          description: string;
          rule_type: string;
          schedule: string;
          condition: string;
          actions: string;
          enabled: number;
          last_triggered: string;
          created_at: string;
        }>("SELECT * FROM automation_rules");
        const automationRules = ruleRows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description || "",
          ruleType: r.rule_type as "schedule" | "condition",
          schedule: r.schedule || null,
          condition: r.condition || null,
          actions: JSON.parse(r.actions),
          enabled: !!r.enabled,
          lastTriggered: r.last_triggered || null,
          createdAt: r.created_at,
        }));

        // Google — cached calendar events
        const calendarEvents = (
          await db.getAllAsync<{
            event_id: string;
            summary: string;
            description: string;
            location: string;
            start_time: string;
            end_time: string;
            all_day: number;
            status: string;
            html_link: string;
            google_calendar_id: string;
            synced_at: string;
          }>("SELECT * FROM calendar_events ORDER BY start_time ASC")
        ).map((r) => ({
          ...r,
          all_day: !!r.all_day,
          description: r.description || null,
          location: r.location || null,
          html_link: r.html_link || null,
        }));

        // Google — cached emails with categories
        const emailRows = await db.getAllAsync<{
          message_id: string;
          thread_id: string;
          from_address: string;
          subject: string;
          snippet: string;
          date: string;
          is_unread: number;
          is_starred: number;
          label_ids: string;
          body_text: string;
        }>("SELECT * FROM email_cache ORDER BY date DESC LIMIT 50");
        const emailCatRows = await db.getAllAsync<{
          message_id: string;
          category: string;
          extracted_tasks: string;
        }>("SELECT * FROM email_categories");
        const catMap = new Map(emailCatRows.map((r) => [r.message_id, r]));
        const emails: CachedEmail[] = emailRows.map((r) => {
          const cat = catMap.get(r.message_id);
          return {
            message_id: r.message_id,
            thread_id: r.thread_id,
            from_address: r.from_address,
            subject: r.subject,
            snippet: r.snippet || "",
            date: r.date,
            is_unread: !!r.is_unread,
            is_starred: !!r.is_starred,
            label_ids: r.label_ids ? JSON.parse(r.label_ids) : [],
            category: (cat?.category as CachedEmail["category"]) ?? null,
            extracted_tasks: cat?.extracted_tasks
              ? JSON.parse(cat.extracted_tasks)
              : [],
          };
        });
        const unreadEmailCount = emails.filter((e) => e.is_unread).length;

        // Last 7 days: hydration and sleep for charts
        const sevenDaysAgo = dayjs().subtract(6, "day").startOf("day");
        const dayLabels: string[] = [];
        for (let i = 0; i < 7; i++) {
          dayLabels.push(dayjs(sevenDaysAgo).add(i, "day").format("ddd"));
        }
        const hydRows = await db.getAllAsync<{ day: string; total: number }>(
          "SELECT date(timestamp) as day, COALESCE(SUM(amount_ml),0) as total FROM hydration_logs WHERE timestamp >= ? GROUP BY date(timestamp)",
          [sevenDaysAgo.toISOString()],
        );
        const hydMap = new Map(hydRows.map((r) => [r.day, r.total]));
        const hydrationLast7Days = {
          days: dayLabels,
          values: Array.from(
            { length: 7 },
            (_, i) =>
              hydMap.get(
                dayjs(sevenDaysAgo).add(i, "day").format("YYYY-MM-DD"),
              ) ?? 0,
          ),
        };
        const sleepRows = await db.getAllAsync<{
          day: string;
          total: number;
        }>(
          "SELECT date(sleep_start) as day, COALESCE(SUM(duration_minutes),0) as total FROM sleep_sessions WHERE sleep_start >= ? GROUP BY date(sleep_start)",
          [sevenDaysAgo.toISOString()],
        );
        const sleepMap = new Map(sleepRows.map((r) => [r.day, r.total]));
        const sleepLast7Days = {
          days: dayLabels,
          values: Array.from(
            { length: 7 },
            (_, i) =>
              sleepMap.get(
                dayjs(sevenDaysAgo).add(i, "day").format("YYYY-MM-DD"),
              ) ?? 0,
          ),
        };

        const profileRow = await db.getFirstAsync<UserProfile>(
          "SELECT * FROM user_profile WHERE id = 'default' LIMIT 1",
        );
        const userProfile: UserProfile | null = profileRow ?? null;
        const weightLogs = await db.getAllAsync<WeightLog>(
          "SELECT * FROM weight_log ORDER BY date DESC LIMIT 100",
        );

        set({
          ready: true,
          tasks,
          sleepSessions,
          hydrationLast7Days,
          sleepLast7Days,
          userProfile,
          weightLogs,
          reminders,
          hydrationTodayMl,
          hydrationLogs: hydrationLogs.map((l) => ({
            ...l,
            synced: !!l.synced,
          })),
          queueCount: queuedEvents.length,
          queuedEvents,
          chatSessions,
          currentChatId,
          aiCommands,
          aiMemories,
          partnerSnippets,
          routines,
          automationRules,
          isBackendConfigured: !!kv.getString("backend_url"),
          isAuthenticated: !!kv.getString("user_id"),
          isGoogleConnected: kv.getBool("google_connected"),
          googleEmail: kv.getString("google_email") || null,
          isMicrosoftConnected: kv.getBool("microsoft_connected"),
          microsoftEmail: kv.getString("microsoft_email") || null,
          calendarEvents,
          emails,
          unreadEmailCount,
        });

        // Restore backend auth + MQTT if configured
        if (kv.getString("backend_url") && kv.getString("user_id")) {
          try {
            const { auth } = await import("../services/auth");
            const restored = await auth.restore();
            set({ isAuthenticated: restored });
            if (restored && !kv.getString("server_coach_enabled")) {
              kv.set("server_coach_enabled", "1");
            }
          } catch (e) {
            console.log("[LifeOS] Auth restore skipped:", e);
          }
        }
        // Ensure non-negotiable features are always on
        kv.set("encryption_enabled", true);
        kv.set("notifications_enabled", true);

        // Load habits & calculate streaks
        get().loadHabits();
        get().loadMoodLogs();
        get().loadNotes();
        get().loadInbox();
        get().loadTimeBlocks();
        get().loadExpenses();
        get().loadBudgets();
        get().updateDailyStreak();

        // Load agentic system state (goals, plans, patterns, watcher queue)
        // Loaded here (not in initAgentSystem) to avoid race conditions
        await Promise.all([
          get().loadGoals().catch((e: any) => console.warn('[init] goals:', e)),
          get().loadPlans().catch((e: any) => console.warn('[init] plans:', e)),
          get().loadPatterns().catch((e: any) => console.warn('[init] patterns:', e)),
          get().loadWatcherQueue().catch((e: any) => console.warn('[init] watcher:', e)),
          get().loadCoachingCommitments().catch((e: any) => console.warn('[init] coaching:', e)),
        ]);

        get().syncServerCoachState().catch(() => {});
        get().syncUserCoachTimezoneToServer().catch(() => {});
        get().pullServerData().catch(() => {});

        // Rebuild FTS5 search index in background (non-blocking)
        import("../db/search").then(({ rebuildSearchIndex }) => {
          rebuildSearchIndex().catch((e) =>
            console.warn("[LifeOS] Search index rebuild failed:", e),
          );
        });

        // Auto-extract bundled or download LLM models if not present
        const FileSystem = await import("expo-file-system/legacy");
        const { extractBundledFastModel } = await import("../llm/ModelManager");

        const fastPath = kv.getString("llm_fast_model_path");
        if (fastPath) {
          const info = await FileSystem.getInfoAsync(fastPath);
          if (!info.exists) {
            kv.delete("llm_fast_model_path");
            set({
              llmFastModelStatus: "not_downloaded",
              llmFastModelPath: null,
            });
            // Try bundled asset first, then download
            const bundledPath = await extractBundledFastModel();
            if (bundledPath) {
              kv.set("llm_fast_model_path", bundledPath);
              set({ llmFastModelStatus: "downloaded", llmFastModelPath: bundledPath });
            } else {
              get().downloadFastModel();
            }
          }
        } else {
          // Try bundled asset first, then download
          const bundledPath = await extractBundledFastModel();
          if (bundledPath) {
            kv.set("llm_fast_model_path", bundledPath);
            set({ llmFastModelStatus: "downloaded", llmFastModelPath: bundledPath });
          } else {
            get().downloadFastModel();
          }
        }

        const llmPath = kv.getString("llm_model_path");
        if (llmPath) {
          const info = await FileSystem.getInfoAsync(llmPath);
          if (!info.exists) {
            kv.delete("llm_model_path");
            set({ llmModelStatus: "not_downloaded", llmModelPath: null });
            get().downloadLlmModel();
          }
        } else {
          get().downloadLlmModel();
        }
      } catch (e) {
        console.error("[LifeOS] init failed:", e);
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
    if (get().llmFastModelStatus === "downloading") return;
    const { FAST_MODEL } = await import("../llm/types");
    const ModelManager = await import("../llm/ModelManager");

    set({
      llmFastModelStatus: "downloading",
      llmFastDownloadProgress: {
        totalBytes: FAST_MODEL.sizeBytes,
        downloadedBytes: 0,
        percent: 0,
      },
    });

    try {
      const handle = await ModelManager.download("fast", (progress) => {
        set({ llmFastDownloadProgress: progress });
      });
      await handle.downloadAsync();
      const path = ModelManager.modelPath("fast");
      kv.set("llm_fast_model_path", path);
      set({
        llmFastModelStatus: "downloaded",
        llmFastModelPath: path,
        llmFastDownloadProgress: null,
      });
      console.log("[LLM] Fast model downloaded:", path);
    } catch (e) {
      console.error("[LLM] Fast model download failed:", e);
      set({ llmFastModelStatus: "error", llmFastDownloadProgress: null });
    }
  },

  // Heavy model (3B)
  downloadLlmModel: async () => {
    if (get().llmModelStatus === "downloading") return;
    const { HEAVY_MODEL } = await import("../llm/types");
    const ModelManager = await import("../llm/ModelManager");

    set({
      llmModelStatus: "downloading",
      llmError: null,
      llmDownloadProgress: {
        totalBytes: HEAVY_MODEL.sizeBytes,
        downloadedBytes: 0,
        percent: 0,
      },
    });

    try {
      const handle = await ModelManager.download("heavy", (progress) => {
        set({ llmDownloadProgress: progress });
      });
      await handle.downloadAsync();
      const path = ModelManager.modelPath("heavy");
      kv.set("llm_model_path", path);
      set({
        llmModelStatus: "downloaded",
        llmModelPath: path,
        llmDownloadProgress: null,
      });
      console.log("[LLM] Heavy model downloaded:", path);
    } catch (e) {
      console.error("[LLM] Heavy model download failed:", e);
      set({
        llmModelStatus: "error",
        llmError: `Download failed: ${(e as Error).message}`,
        llmDownloadProgress: null,
      });
    }
  },

  deleteLlmModel: async () => {
    const { LlamaService } = await import("../llm/LlamaService");
    const ModelManager = await import("../llm/ModelManager");
    await LlamaService.release();
    await ModelManager.deleteModel("fast");
    await ModelManager.deleteModel("heavy");
    kv.delete("llm_fast_model_path");
    kv.delete("llm_model_path");
    set({
      llmFastModelStatus: "not_downloaded",
      llmFastModelPath: null,
      llmModelStatus: "not_downloaded",
      llmModelPath: null,
      llmLoaded: false,
    });
  },

  setSleep: (s) => {
    const newSleep = { ...get().sleep, ...s };
    kv.setJSON("sleep", newSleep);
    set({ sleep: newSleep });
  },

  // ── Hydration ──
  logHydration: async (ml) => {
    const db = await getDatabase();
    const id = uid();
    const ts = dayjs().toISOString();
    await db.runAsync(
      "INSERT INTO hydration_logs (log_id, amount_ml, timestamp, synced) VALUES (?,?,?,0)",
      [id, ml, ts],
    );
    const newTotal = get().hydrationTodayMl + ml;
    kv.set("hydration_today", newTotal);
    const log: HydrationLog = {
      log_id: id,
      amount_ml: ml,
      timestamp: ts,
      synced: false,
    };
    set({
      hydrationTodayMl: newTotal,
      hydrationLogs: [log, ...get().hydrationLogs],
    });
    get().loadLast7Days();

    // Sync to backend or queue — SYSTEM.md §5
    if (!get().isOnline) {
      await get().enqueueEvent("hydration", {
        log_id: id,
        amount_ml: ml,
        timestamp: ts,
      });
    } else if (get().isBackendConfigured && get().isAuthenticated) {
      try {
        const { api } = await import("../services/api");
        const result = await api.logHydration({
          log_id: id,
          amount_ml: ml,
          timestamp: ts,
        });
        if (result.ok) {
          await db.runAsync(
            "UPDATE hydration_logs SET synced = 1 WHERE log_id = ?",
            [id],
          );
          set({
            hydrationLogs: get().hydrationLogs.map((l) =>
              l.log_id === id ? { ...l, synced: true } : l,
            ),
          });
        }
      } catch {
        await get().enqueueEvent("hydration", {
          log_id: id,
          amount_ml: ml,
          timestamp: ts,
        });
      }
    }

    // Update streak after logging hydration
    get().updateDailyStreak();
  },

  loadHydrationToday: async () => {
    const db = await getDatabase();
    const todayStart = dayjs().startOf("day").toISOString();
    const row = await db.getFirstAsync<{ total: number }>(
      "SELECT COALESCE(SUM(amount_ml),0) as total FROM hydration_logs WHERE timestamp >= ?",
      [todayStart],
    );
    const total = row?.total ?? 0;
    kv.set("hydration_today", total);
    set({ hydrationTodayMl: total });
  },

  // ── Sleep sessions ──
  addSleepSession: async (start, end, durationMin) => {
    const db = await getDatabase();
    const id = uid();
    await db.runAsync(
      "INSERT INTO sleep_sessions (session_id, sleep_start, sleep_end, duration_minutes) VALUES (?,?,?,?)",
      [id, start, end, durationMin],
    );
    const session: import("../agent/types").SleepSession = {
      session_id: id,
      sleep_start: start,
      sleep_end: end,
      duration_minutes: durationMin,
    };
    set({ sleepSessions: [session, ...get().sleepSessions] });
    get().updateDailyStreak();
    get().loadLast7Days();
    await get().enqueueEvent("sleep_session_upsert", {
      session_id: id,
      sleep_start: start,
      sleep_end: end,
      duration_minutes: durationMin,
    });
  },
  deleteSleepSession: async (sessionId) => {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM sleep_sessions WHERE session_id = ?", [sessionId]);
    set({
      sleepSessions: get().sleepSessions.filter((s) => s.session_id !== sessionId),
    });
    get().updateDailyStreak();
    get().loadLast7Days();
    await get().enqueueEvent("sleep_session_delete", { session_id: sessionId });
  },

  loadLast7Days: async () => {
    const db = await getDatabase();
    const sevenDaysAgo = dayjs().subtract(6, "day").startOf("day");
    const dayLabels: string[] = [];
    for (let i = 0; i < 7; i++) {
      dayLabels.push(dayjs(sevenDaysAgo).add(i, "day").format("ddd"));
    }
    const hydRows = await db.getAllAsync<{ day: string; total: number }>(
      "SELECT date(timestamp) as day, COALESCE(SUM(amount_ml),0) as total FROM hydration_logs WHERE timestamp >= ? GROUP BY date(timestamp)",
      [sevenDaysAgo.toISOString()],
    );
    const hydMap = new Map(hydRows.map((r) => [r.day, r.total]));
    const hydrationLast7Days = {
      days: dayLabels,
      values: Array.from(
        { length: 7 },
        (_, i) =>
          hydMap.get(dayjs(sevenDaysAgo).add(i, "day").format("YYYY-MM-DD")) ??
          0,
      ),
    };
    const sleepRows = await db.getAllAsync<{ day: string; total: number }>(
      "SELECT date(sleep_start) as day, COALESCE(SUM(duration_minutes),0) as total FROM sleep_sessions WHERE sleep_start >= ? GROUP BY date(sleep_start)",
      [sevenDaysAgo.toISOString()],
    );
    const sleepMap = new Map(sleepRows.map((r) => [r.day, r.total]));
    const sleepLast7Days = {
      days: dayLabels,
      values: Array.from(
        { length: 7 },
        (_, i) =>
          sleepMap.get(dayjs(sevenDaysAgo).add(i, "day").format("YYYY-MM-DD")) ??
          0,
      ),
    };
    set({ hydrationLast7Days, sleepLast7Days });
  },

  loadSleepSessions: async (period = "today") => {
    const db = await getDatabase();
    const since =
      period === "week"
        ? dayjs().subtract(7, "day").startOf("day").toISOString()
        : dayjs().startOf("day").toISOString();
    const rows = await db.getAllAsync<import("../agent/types").SleepSession>(
      "SELECT * FROM sleep_sessions WHERE sleep_start >= ? ORDER BY sleep_start DESC",
      [since],
    );
    set({ sleepSessions: rows });
  },

  // ── Reminders ──
  addReminder: async (text, triggerAt) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      "INSERT INTO reminders (reminder_id, text, trigger_at, fired, created_at) VALUES (?,?,?,0,?)",
      [id, text, triggerAt, now],
    );
    const reminder: import("../agent/types").Reminder = {
      reminder_id: id,
      text,
      trigger_at: triggerAt,
      fired: false,
      created_at: now,
    };
    set({
      reminders: [...get().reminders, reminder].sort((a, b) =>
        a.trigger_at.localeCompare(b.trigger_at),
      ),
    });
  },

  loadReminders: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      reminder_id: string;
      text: string;
      trigger_at: string;
      fired: number;
      created_at: string;
    }>("SELECT * FROM reminders WHERE fired = 0 ORDER BY trigger_at ASC");
    set({ reminders: rows.map((r) => ({ ...r, fired: !!r.fired })) });
  },

  // ── Auto sleep/wake routines ──
  setAutoMorning: (v) => {
    kv.set("auto_morning_enabled", v);
    set({ autoMorningEnabled: v });
    import("../db/database").then(({ saveAppSettings }) =>
      saveAppSettings({ auto_morning_enabled: v }).catch((e) =>
        console.warn("[LifeOS] saveAppSettings failed:", e),
      ),
    );
  },
  setAutoNight: (v) => {
    kv.set("auto_night_enabled", v);
    set({ autoNightEnabled: v });
    import("../db/database").then(({ saveAppSettings }) =>
      saveAppSettings({ auto_night_enabled: v }).catch((e) =>
        console.warn("[LifeOS] saveAppSettings failed:", e),
      ),
    );
  },

  // ── Hydration reminders ──
  setHydrationReminder: (startHour, endHour, goalMl, customIntervalMin) => {
    const { calculateSchedule } =
      require("../utils/hydrationCalc") as typeof import("../utils/hydrationCalc");
    const schedule = calculateSchedule(
      startHour,
      endHour,
      goalMl,
      get().hydrationTodayMl,
      customIntervalMin,
    );

    kv.set("hydration_reminder_enabled", true);
    kv.set("hydration_start_hour", startHour);
    kv.set("hydration_end_hour", endHour);
    kv.set("hydration_goal_ml", goalMl);
    kv.set("hydration_interval_min", schedule.intervalMin);
    kv.set("hydration_next_at", schedule.firstReminderAt);
    kv.set("hydration_dose_per", schedule.dosePerReminderMl);
    kv.set("hydration_skipped_ml", 0);

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
    kv.set("hydration_reminder_enabled", false);
    kv.set("hydration_skipped_ml", 0);
    set({
      hydrationReminderEnabled: false,
      hydrationSkippedMl: 0,
      nextHydrationReminderAt: null,
    });
  },

  skipHydrationDose: (ml) => {
    const newSkipped = get().hydrationSkippedMl + ml;
    kv.set("hydration_skipped_ml", newSkipped);
    set({ hydrationSkippedMl: newSkipped });
  },

  clearSkippedDose: () => {
    kv.set("hydration_skipped_ml", 0);
    set({ hydrationSkippedMl: 0 });
  },

  advanceHydrationReminder: () => {
    const { nextHydrationReminderAt, hydrationIntervalMin } = get();
    if (!nextHydrationReminderAt) return;
    const next = dayjs(nextHydrationReminderAt)
      .add(hydrationIntervalMin, "minute")
      .toISOString();
    kv.set("hydration_next_at", next);
    set({ nextHydrationReminderAt: next });
  },

  recalculateHydrationSchedule: () => {
    const { recalculateAfterFocus } =
      require("../utils/hydrationCalc") as typeof import("../utils/hydrationCalc");
    const s = get();
    const { newDosePerReminder } = recalculateAfterFocus(
      s.hydrationEndHour,
      s.hydrationGoalMl,
      s.hydrationTodayMl,
      s.hydrationIntervalMin,
    );
    kv.set("hydration_dose_per", newDosePerReminder);
    kv.set("hydration_skipped_ml", 0);
    set({
      hydrationDosePerReminder: newDosePerReminder,
      hydrationSkippedMl: 0,
    });
  },

  // ── Focus mode ──
  toggleFocus: (durationMin = 45) => {
    const enabled = !get().focusEnabled;
    const now = dayjs().toISOString();
    kv.set("focus_enabled", enabled);
    if (enabled) {
      kv.set("focus_started", now);
      kv.set("focus_duration", durationMin);
      kv.set("focus_remaining", durationMin);
      set({
        focusEnabled: true,
        focusStartedAt: now,
        focusDurationMin: durationMin,
        focusRemainingMin: durationMin,
      });
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
      kv.set("focus_enabled", false);
      set({ focusEnabled: false, focusRemainingMin: 0 });
      // Recalculate hydration schedule if reminders are active and doses were skipped
      if (get().hydrationReminderEnabled && get().hydrationSkippedMl > 0) {
        get().recalculateHydrationSchedule();
      }
    } else {
      kv.set("focus_remaining", r - 1);
      set({ focusRemainingMin: r - 1 });
    }
  },

  // ── Tasks CRUD ──
  addTask: async (
    title,
    priority = "medium",
    dueDate = null,
    notes = "",
    recurrence = null,
  ) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      "INSERT INTO tasks (task_id,title,due_date,priority,notes,status,recurrence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, title, dueDate, priority, notes, "pending", recurrence, now, now],
    );
    const task: Task = {
      task_id: id,
      title,
      due_date: dueDate,
      priority,
      notes,
      status: "pending",
      recurrence,
      created_at: now,
      updated_at: now,
    };
    set({ tasks: [task, ...get().tasks] });
    ftsIndex("task", id, title, notes, priority, dueDate ?? "");
    await get().enqueueEvent("task_create", {
      task_id: id,
      title,
      due_date: dueDate,
      priority,
      notes,
      status: "pending",
      recurrence,
    });
  },

  updateTask: async (taskId, fields) => {
    const db = await getDatabase();
    const now = dayjs().toISOString();
    const sets: string[] = ["updated_at = ?"];
    const vals: unknown[] = [now];
    for (const [k, v] of Object.entries(fields)) {
      if (k !== "task_id" && k !== "created_at") {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    vals.push(taskId);
    await db.runAsync(
      `UPDATE tasks SET ${sets.join(", ")} WHERE task_id = ?`,
      vals as string[],
    );
    set({
      tasks: get().tasks.map((t) =>
        t.task_id === taskId ? { ...t, ...fields, updated_at: now } : t,
      ),
    });

    // Update streak when task completed
    if (fields.status === "completed") {
      get().updateDailyStreak();
    }

    // Auto-create next occurrence for recurring tasks on completion
    if (fields.status === "completed") {
      const task = get().tasks.find((t) => t.task_id === taskId);
      if (task?.recurrence) {
        try {
          const { calculateNextDueDate } = await import("../utils/recurrence");
          const nextDue = calculateNextDueDate(
            task.recurrence,
            task.due_date ?? now,
          );
          await get().addTask(
            task.title,
            task.priority,
            nextDue,
            task.notes,
            task.recurrence,
          );
        } catch (e) {
          console.error("[LifeOS] Failed to create next recurring task:", e);
        }
      }
    }
    await get().enqueueEvent("task_update", { task_id: taskId, ...fields });
  },

  deleteTask: async (taskId) => {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM tasks WHERE task_id = ?", [taskId]);
    set({ tasks: get().tasks.filter((t) => t.task_id !== taskId) });
    ftsRemove(taskId);
    await get().enqueueEvent("task_delete", { task_id: taskId });
  },

  loadTasks: async () => {
    const db = await getDatabase();
    const tasks = await db.getAllAsync<Task>(
      "SELECT * FROM tasks ORDER BY created_at DESC",
    );
    set({ tasks });

    // Roll-forward recurring tasks: if a recurring task is overdue, create the next instance (one per run)
    const todayStart = dayjs().startOf("day");
    const createdKey = new Set<string>();
    for (const task of tasks) {
      if (!task.recurrence) continue;
      const due = task.due_date ? dayjs(task.due_date) : dayjs();
      if (due.isAfter(todayStart) || due.isSame(todayStart, "day")) continue;
      try {
        const { calculateNextDueDate } = await import("../utils/recurrence");
        const nextDue = calculateNextDueDate(
          task.recurrence,
          task.due_date ?? dayjs().toISOString(),
        );
        const nextDueDay = dayjs(nextDue).startOf("day");
        if (nextDueDay.isBefore(todayStart)) continue;
        const key = `${task.title}|${nextDueDay.toISOString()}`;
        if (createdKey.has(key)) continue;
        const alreadyExists = tasks.some(
          (t) =>
            t.title === task.title &&
            t.due_date &&
            dayjs(t.due_date).isSame(nextDueDay, "day"),
        );
        if (alreadyExists) continue;
        await get().addTask(
          task.title,
          task.priority,
          nextDue,
          task.notes ?? "",
          task.recurrence,
        );
        createdKey.add(key);
      } catch (e) {
        console.warn("[LifeOS] Roll-forward recurring task failed:", e);
      }
    }
  },

  // ── Offline queue — SYSTEM.md §5 ──
  enqueueEvent: async (type, payload) => {
    // Skip queueing if no backend configured — data is safe in local SQLite
    if (!get().isBackendConfigured) {
      console.log('[Store] Skipping event queue — no backend configured (data persisted locally)');
      return;
    }
    const db = await getDatabase();
    const id = uid();
    await db.runAsync(
      "INSERT INTO event_queue (id,type,payload,created_at,retry_count,status) VALUES (?,?,?,?,0,'pending')",
      [id, type, JSON.stringify(payload), dayjs().toISOString()],
    );
    const newCount = get().queueCount + 1;
    kv.set("queue_count", newCount);
    set({ queueCount: newCount });
  },

  loadQueue: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<QueuedEvent>(
      "SELECT * FROM event_queue WHERE status = 'pending' ORDER BY created_at ASC",
    );
    set({ queuedEvents: rows, queueCount: rows.length });
    kv.set("queue_count", rows.length);
  },

  drainQueue: async () => {
    const db = await getDatabase();
    const maxRetries = 5;
    const rows = await db.getAllAsync<QueuedEvent>(
      "SELECT * FROM event_queue WHERE status = 'pending'",
    );

    if (rows.length === 0) return;

    // If backend is configured and authenticated, send batch to server
    if (get().isBackendConfigured && get().isAuthenticated) {
      try {
        const { api } = await import("../services/api");
        const result = await api.syncBatch(rows);

        if (result.ok) {
          const failedIds = new Set(result.data.failed);

          for (const row of rows) {
            if (failedIds.has(row.id)) {
              // Increment retry count for events rejected by server.
              await db.runAsync(
                `UPDATE event_queue
                 SET retry_count = retry_count + 1,
                     status = CASE WHEN retry_count + 1 >= ? THEN 'failed' ELSE 'pending' END
                 WHERE id = ?`,
                [maxRetries, row.id],
              );
            } else {
              // Successfully synced — delete from queue
              await db.runAsync("DELETE FROM event_queue WHERE id = ?", [
                row.id,
              ]);

              // Mark corresponding records as synced
              try {
                const payload = JSON.parse(row.payload);
                if (row.type === "hydration" && payload.log_id) {
                  await db.runAsync(
                    "UPDATE hydration_logs SET synced = 1 WHERE log_id = ?",
                    [payload.log_id],
                  );
                }
              } catch {
                /* ignore parse errors */
              }
            }
          }

          // Update queue count
          const remaining = await db.getAllAsync<QueuedEvent>(
            "SELECT * FROM event_queue WHERE status = 'pending'",
          );
          kv.set("queue_count", remaining.length);
          set({ queueCount: remaining.length, queuedEvents: remaining });
          return;
        }
        for (const row of rows) {
          await db.runAsync(
            `UPDATE event_queue
             SET retry_count = retry_count + 1,
                 status = CASE WHEN retry_count + 1 >= ? THEN 'failed' ELSE 'pending' END
             WHERE id = ?`,
            [maxRetries, row.id],
          );
        }
      } catch (e) {
        console.error("[LifeOS] Batch sync failed:", e);
        for (const row of rows) {
          await db.runAsync(
            `UPDATE event_queue
             SET retry_count = retry_count + 1,
                 status = CASE WHEN retry_count + 1 >= ? THEN 'failed' ELSE 'pending' END
             WHERE id = ?`,
            [maxRetries, row.id],
          );
        }
      }
    }

    const remaining = await db.getAllAsync<QueuedEvent>(
      "SELECT * FROM event_queue WHERE status = 'pending' ORDER BY created_at ASC",
    );
    kv.set("queue_count", remaining.length);
    set({ queueCount: remaining.length, queuedEvents: remaining });
  },

  pullServerData: async () => {
    if (!get().isBackendConfigured || !get().isAuthenticated) return;
    try {
      const { api } = await import("../services/api");
      const db = await getDatabase();

      // Build skip-sets from pending event queue to avoid overwriting local changes
      const pendingRows = await db.getAllAsync<{ type: string; payload: string }>(
        "SELECT type, payload FROM event_queue WHERE status = 'pending'",
      );
      const pendingTaskIds = new Set<string>();
      const pendingHydrationIds = new Set<string>();
      const pendingSleepIds = new Set<string>();
      const pendingSnippetIds = new Set<string>();
      for (const row of pendingRows) {
        try {
          const p = JSON.parse(row.payload);
          if (row.type.startsWith("task") && p.task_id) pendingTaskIds.add(p.task_id);
          if (row.type === "hydration" && p.log_id) pendingHydrationIds.add(p.log_id);
          if (row.type === "sleep" && p.session_id) pendingSleepIds.add(p.session_id);
          if (row.type === "partner_snippet" && p.snippet_id) pendingSnippetIds.add(p.snippet_id);
        } catch { /* ignore parse errors */ }
      }

      const [tasksRes, hydrationRes, sleepRes, snippetsRes] = await Promise.all([
        api.getTasks().catch(() => null),
        api.getHydration().catch(() => null),
        api.getSleepSessions().catch(() => null),
        api.getPartnerSnippets().catch(() => null),
      ]);

      // Upsert tasks
      if (tasksRes?.ok && tasksRes.data.tasks) {
        for (const t of tasksRes.data.tasks) {
          if (pendingTaskIds.has(t.task_id as string)) continue;
          await db.runAsync(
            `INSERT OR REPLACE INTO tasks (task_id, title, due_date, priority, notes, status, recurrence, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [t.task_id, t.title, t.due_date || null, t.priority, t.notes, t.status, t.recurrence || null, t.created_at, t.updated_at],
          );
        }
        const tasks = await db.getAllAsync<Task>("SELECT * FROM tasks ORDER BY created_at DESC");
        set({ tasks });
      }

      // Upsert hydration
      if (hydrationRes?.ok && hydrationRes.data.logs) {
        for (const h of hydrationRes.data.logs) {
          if (pendingHydrationIds.has(h.log_id as string)) continue;
          await db.runAsync(
            `INSERT OR REPLACE INTO hydration_logs (log_id, amount_ml, timestamp, synced) VALUES (?, ?, ?, 1)`,
            [h.log_id, h.amount_ml, h.timestamp],
          );
        }
      }

      // Upsert sleep sessions
      if (sleepRes?.ok && sleepRes.data.sessions) {
        for (const s of sleepRes.data.sessions) {
          if (pendingSleepIds.has(s.session_id as string)) continue;
          await db.runAsync(
            `INSERT OR REPLACE INTO sleep_sessions (session_id, sleep_start, sleep_end, duration_minutes) VALUES (?, ?, ?, ?)`,
            [s.session_id, s.sleep_start, s.sleep_end, s.duration_minutes],
          );
        }
      }

      // Upsert partner snippets
      if (snippetsRes?.ok && snippetsRes.data.snippets) {
        for (const p of snippetsRes.data.snippets) {
          if (pendingSnippetIds.has(p.snippet_id as string)) continue;
          await db.runAsync(
            `INSERT OR REPLACE INTO partner_snippets (snippet_id, partner_id, content, timestamp) VALUES (?, ?, ?, ?)`,
            [p.snippet_id, p.partner_id, p.content, p.timestamp],
          );
        }
      }

      console.log("[LifeOS] pullServerData complete");
    } catch (e) {
      console.warn("[LifeOS] pullServerData failed:", e);
    }
  },

  syncUserCoachTimezoneToServer: async () => {
    if (!get().isBackendConfigured || !get().isAuthenticated) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    const prev = kv.getString("coach_timezone_sent");
    if (prev === tz) return;
    await get().enqueueEvent("user_settings_upsert", { coach_timezone: tz });
    kv.set("coach_timezone_sent", tz);
    await get().drainQueue();
  },

  // ── Chat sessions ──
  addChatSession: async () => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      "INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [id, "New chat", now, now],
    );
    const session: ChatSession = {
      id,
      title: "New chat",
      created_at: now,
      updated_at: now,
    };
    kv.set("current_chat_id", id);
    set({
      currentChatId: id,
      chatSessions: [session, ...get().chatSessions],
      aiCommands: [],
    });
    return id;
  },

  setCurrentChat: (chatId) => {
    if (chatId) kv.set("current_chat_id", chatId);
    else kv.delete("current_chat_id");
    set({ currentChatId: chatId });
    if (chatId)
      get()
        .loadAiCommandsForChat(chatId)
        .catch(() => {});
    else set({ aiCommands: [] });
  },

  loadChatSessions: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<ChatSession>(
      "SELECT id, title, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT 100",
    );
    set({ chatSessions: rows });
  },

  loadAiCommandsForChat: async (chatId) => {
    const db = await getDatabase();
    const rows = (
      await db.getAllAsync<AiCommand & { source?: string }>(
        "SELECT * FROM ai_commands WHERE chat_id = ? ORDER BY created_at ASC",
        [chatId],
      )
    ).map((c) => ({
      ...c,
      chat_id: c.chat_id ?? chatId,
      source: (c.source || "user") as AiCommand["source"],
    }));
    set({ aiCommands: rows });
  },

  updateChatTitle: async (chatId, title) => {
    const db = await getDatabase();
    const now = dayjs().toISOString();
    await db.runAsync(
      "UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?",
      [title, now, chatId],
    );
    set({
      chatSessions: get().chatSessions.map((s) =>
        s.id === chatId ? { ...s, title, updated_at: now } : s,
      ),
    });
  },

  deleteChatSession: async (chatId) => {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM ai_commands WHERE chat_id = ?", [chatId]);
    await db.runAsync("DELETE FROM chat_sessions WHERE id = ?", [chatId]);
    const sessions = get().chatSessions.filter((s) => s.id !== chatId);
    const nextId = sessions[0]?.id ?? null;
    if (get().currentChatId === chatId) {
      if (nextId) kv.set("current_chat_id", nextId);
      else kv.delete("current_chat_id");
      set({ currentChatId: nextId, chatSessions: sessions, aiCommands: [] });
      if (nextId) get().loadAiCommandsForChat(nextId);
    } else {
      set({ chatSessions: sessions });
    }
  },

  // ── AI commands ──
  addAiCommand: async (input, source = "user") => {
    const db = await getDatabase();
    let chatId = get().currentChatId;
    if (!chatId) {
      chatId = await get().addChatSession();
    }
    const id = uid();
    const now = dayjs().toISOString();
    const status = get().isOnline ? "pending" : "queued";
    await db.runAsync(
      "INSERT INTO ai_commands (id, chat_id, input, output, status, source, created_at) VALUES (?,?,?,?,?,?,?)",
      [id, chatId, input, null, status, source, now],
    );
    await db.runAsync("UPDATE chat_sessions SET updated_at = ? WHERE id = ?", [
      now,
      chatId,
    ]);
    const cmd: AiCommand = {
      id,
      chat_id: chatId,
      input,
      output: null,
      status,
      source,
      created_at: now,
    };
    set({ aiCommands: [...get().aiCommands, cmd] });

    if (!get().isOnline) {
      await get().enqueueEvent("ai_command", { id, input });
    }
    return id;
  },

  resolveAiCommand: async (id, output, status) => {
    const db = await getDatabase();
    await db.runAsync(
      "UPDATE ai_commands SET output = ?, status = ? WHERE id = ?",
      [output, status, id],
    );
    const cmd = get().aiCommands.find((c) => c.id === id);
    const now = dayjs().toISOString();
    if (cmd?.chat_id) {
      await db.runAsync(
        "UPDATE chat_sessions SET updated_at = ? WHERE id = ?",
        [now, cmd.chat_id],
      );
      const session = get().chatSessions.find((s) => s.id === cmd.chat_id);
      if (session?.title === "New chat" && cmd.source === "user") {
        // Quick fallback title
        const fallbackTitle =
          cmd.input.slice(0, 42) + (cmd.input.length > 42 ? "…" : "");
        await db.runAsync(
          "UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?",
          [fallbackTitle, now, cmd.chat_id],
        );
        set({
          chatSessions: get().chatSessions.map((s) =>
            s.id === cmd.chat_id
              ? { ...s, title: fallbackTitle, updated_at: now }
              : s,
          ),
        });

        // Async smart title: use fast LLM if loaded (non-blocking)
        const chatId = cmd.chat_id;
        const userInput = cmd.input;
        const aiOutput = output;
        (async () => {
          try {
            const { LlamaService } = await import("../llm/LlamaService");
            if (!LlamaService.isFastLoaded) return;
            const result = await LlamaService.completeFast(
              `Summarize this conversation in 3-5 words as a chat title. Output ONLY the title, nothing else.\nUser: ${userInput}\nAssistant: ${(aiOutput || "").slice(0, 200)}`,
              "",
            );
            const smartTitle = result.message
              .replace(/["'*]/g, "")
              .replace(/^title:\s*/i, "")
              .trim();
            if (
              smartTitle.length > 2 &&
              smartTitle.length < 50 &&
              !smartTitle.includes("\n")
            ) {
              const db2 = await getDatabase();
              await db2.runAsync(
                "UPDATE chat_sessions SET title = ? WHERE id = ?",
                [smartTitle, chatId],
              );
              set({
                chatSessions: get().chatSessions.map((s) =>
                  s.id === chatId ? { ...s, title: smartTitle } : s,
                ),
              });
            }
          } catch {
            /* silent — title generation is best-effort */
          }
        })();
      }
    }
    set({
      aiCommands: get().aiCommands.map((c) =>
        c.id === id ? { ...c, output, status } : c,
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
    const today = dayjs().format("YYYY-MM-DD");
    const state = get();

    // Calculate today's score (0-100)
    const hydrationMet =
      state.hydrationTodayMl >= (state.hydrationGoalMl || 2500) ? 1 : 0;
    const tasksCompleted = state.tasks.filter(
      (t) =>
        t.status === "completed" &&
        dayjs(t.updated_at).format("YYYY-MM-DD") === today,
    ).length;
    const sleepLogged = state.sleep.durationMinutes > 0 ? 1 : 0;
    const habitsDone = state.habitLogs.filter(
      (l) => dayjs(l.logged_at).format("YYYY-MM-DD") === today,
    ).length;

    const hydrationPts = hydrationMet * 30;
    const taskPts = Math.min(tasksCompleted * 10, 40);
    const sleepPts = sleepLogged * 20;
    const habitPts = Math.min(habitsDone * 10, 10);
    const score = hydrationPts + taskPts + sleepPts + habitPts;

    await db.runAsync(
      `INSERT OR REPLACE INTO daily_streaks (date, hydration_met, tasks_completed, sleep_logged, habits_done, score)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [today, hydrationMet, tasksCompleted, sleepLogged, habitsDone, score],
    );

    // Calculate streak — consecutive days with score > 0
    const rows = await db.getAllAsync<{ date: string; score: number }>(
      "SELECT date, score FROM daily_streaks ORDER BY date DESC LIMIT 30",
    );

    let streak = 0;
    for (let i = 0; i < rows.length; i++) {
      const expected = dayjs().subtract(i, "day").format("YYYY-MM-DD");
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
      scoreBreakdown: {
        hydration: hydrationPts,
        tasks: taskPts,
        sleep: sleepPts,
        habits: habitPts,
      },
    });

    // Cache to MMKV for Android widget
    kv.set("daily_score", score);
    kv.set("current_streak", streak);

    await get().enqueueEvent("daily_streak_upsert", {
      date: today,
      hydration_met: hydrationMet,
      tasks_completed: tasksCompleted,
      sleep_logged: sleepLogged,
      habits_done: habitsDone,
      score,
    });
  },

  // ── Habits ──

  loadHabits: async () => {
    const db = await getDatabase();
    const since30d =
      dayjs().subtract(30, "day").format("YYYY-MM-DD") + "T00:00:00";
    const habits = await db.getAllAsync<Habit>(
      "SELECT * FROM habits WHERE enabled = 1 ORDER BY created_at",
    );
    const logs = await db.getAllAsync<HabitLog>(
      "SELECT * FROM habit_logs WHERE logged_at >= ? ORDER BY logged_at DESC",
      [since30d],
    );
    set({ habits, habitLogs: logs });
  },

  addHabit: async (
    name: string,
    icon = "✓",
    targetPerDay = 1,
    unit: string | null = null,
  ) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      "INSERT INTO habits (id, name, icon, target_per_day, unit, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, name, icon, targetPerDay, unit, now],
    );
    const habit: Habit = {
      id,
      name,
      icon,
      target_per_day: targetPerDay,
      unit,
      enabled: true,
      created_at: now,
    };
    set({ habits: [...get().habits, habit] });
    ftsIndex("habit", id, name, "", "habit", now);
    await get().enqueueEvent("habit_upsert", {
      id,
      name,
      icon,
      target_per_day: targetPerDay,
      unit,
      enabled: true,
      created_at: now,
    });
    return id;
  },

  logHabitEntry: async (habitId: string, value = 1) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      "INSERT INTO habit_logs (id, habit_id, value, logged_at) VALUES (?, ?, ?, ?)",
      [id, habitId, value, now],
    );
    const log: HabitLog = { id, habit_id: habitId, value, logged_at: now };
    set({ habitLogs: [log, ...get().habitLogs] });
    await get().enqueueEvent("habit_log_upsert", {
      id,
      habit_id: habitId,
      value,
      logged_at: now,
    });
    // Update streak after logging
    get().updateDailyStreak();
  },

  deleteHabit: async (habitId: string) => {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM habits WHERE id = ?", [habitId]);
    await db.runAsync("DELETE FROM habit_logs WHERE habit_id = ?", [habitId]);
    set({
      habits: get().habits.filter((h) => h.id !== habitId),
      habitLogs: get().habitLogs.filter((l) => l.habit_id !== habitId),
    });
  },

  getHabitStats: (habitId: string) => {
    const logs = get().habitLogs.filter((l) => l.habit_id === habitId);
    const habit = get().habits.find((h) => h.id === habitId);
    const target = habit?.target_per_day ?? 1;

    // Group logs by date
    const byDate = new Map<string, number>();
    for (const l of logs) {
      const d = dayjs(l.logged_at).format("YYYY-MM-DD");
      byDate.set(d, (byDate.get(d) ?? 0) + l.value);
    }

    // Current streak
    let currentStreak = 0;
    for (let i = 0; i < 30; i++) {
      const d = dayjs().subtract(i, "day").format("YYYY-MM-DD");
      if ((byDate.get(d) ?? 0) >= target) currentStreak++;
      else break;
    }

    // Best streak
    let bestStreak = 0;
    let tempStreak = 0;
    for (let i = 0; i < 30; i++) {
      const d = dayjs().subtract(i, "day").format("YYYY-MM-DD");
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
      const d = dayjs().subtract(i, "day").format("YYYY-MM-DD");
      if ((byDate.get(d) ?? 0) >= target) weeklyCount++;
    }

    // Last 30 days data for heatmap
    const last30Days: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = dayjs().subtract(i, "day").format("YYYY-MM-DD");
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
    const since =
      dayjs().subtract(30, "day").format("YYYY-MM-DD") + "T00:00:00";
    const rows = await db.getAllAsync<MoodLog>(
      "SELECT * FROM mood_logs WHERE logged_at >= ? ORDER BY logged_at DESC",
      [since],
    );
    set({ moodLogs: rows });
  },

  addMoodLog: async (mood, energy, note) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      "INSERT INTO mood_logs (id, mood, energy, note, logged_at) VALUES (?, ?, ?, ?, ?)",
      [id, mood, energy, note ?? null, now],
    );
    const log: MoodLog = {
      id,
      mood,
      energy,
      note: note ?? null,
      logged_at: now,
    };
    set({ moodLogs: [log, ...get().moodLogs] });
    await get().enqueueEvent("mood_log_upsert", {
      id,
      mood,
      energy,
      note: note ?? null,
      logged_at: now,
    });
  },

  // ── Notes ──

  loadNotes: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      id: string;
      title: string;
      body: string;
      category: string;
      pinned: number;
      created_at: string;
      updated_at: string;
    }>("SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC LIMIT 200");
    set({
      notes: rows.map((r) => ({
        ...r,
        pinned: !!r.pinned,
        category: r.category as "note" | "journal",
      })),
    });
  },

  addNote: async (title, body = "", category = "note") => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      "INSERT INTO notes (id, title, body, category, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
      [id, title, body, category, now, now],
    );
    const note: Note = {
      id,
      title,
      body,
      category,
      pinned: false,
      created_at: now,
      updated_at: now,
    };
    set({ notes: [note, ...get().notes] });
    ftsIndex("note", id, title, body, category, now);
    await get().enqueueEvent("note_upsert", {
      id,
      title,
      body,
      category,
      pinned: false,
      created_at: now,
      updated_at: now,
    });
    return id;
  },

  updateNote: async (id, fields) => {
    const db = await getDatabase();
    const now = dayjs().toISOString();
    const sets: string[] = ["updated_at = ?"];
    const vals: unknown[] = [now];
    for (const [k, v] of Object.entries(fields)) {
      if (k !== "id" && k !== "created_at") {
        sets.push(`${k} = ?`);
        vals.push(k === "pinned" ? (v ? 1 : 0) : v);
      }
    }
    vals.push(id);
    await db.runAsync(
      `UPDATE notes SET ${sets.join(", ")} WHERE id = ?`,
      vals as string[],
    );
    const updated = {
      ...get().notes.find((n) => n.id === id)!,
      ...fields,
      updated_at: now,
    };
    set({ notes: get().notes.map((n) => (n.id === id ? updated : n)) });
    ftsIndex("note", id, updated.title, updated.body, updated.category, now);
    await get().enqueueEvent("note_upsert", {
      id,
      title: updated.title,
      body: updated.body,
      category: updated.category,
      pinned: updated.pinned,
      created_at: updated.created_at,
      updated_at: now,
    });
  },

  deleteNote: async (id) => {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM notes WHERE id = ?", [id]);
    set({ notes: get().notes.filter((n) => n.id !== id) });
    ftsRemove(id);
    await get().enqueueEvent("note_delete", { id });
  },

  // ── Inbox ──

  loadInbox: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      id: string;
      text: string;
      triaged: number;
      triage_result: string | null;
      created_at: string;
    }>("SELECT * FROM inbox_items ORDER BY created_at DESC LIMIT 100");
    set({ inboxItems: rows.map((r) => ({ ...r, triaged: !!r.triaged })) });
  },

  addInboxItem: async (text) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      "INSERT INTO inbox_items (id, text, triaged, created_at) VALUES (?, ?, 0, ?)",
      [id, text, now],
    );
    const item: InboxItem = {
      id,
      text,
      triaged: false,
      triage_result: null,
      created_at: now,
    };
    set({ inboxItems: [item, ...get().inboxItems] });
    await get().enqueueEvent("inbox_item_upsert", {
      id,
      text,
      triaged: false,
      triage_result: null,
      created_at: now,
    });
  },

  triageInboxItem: async (id, result) => {
    const db = await getDatabase();
    const prev = get().inboxItems.find((i) => i.id === id);
    await db.runAsync(
      "UPDATE inbox_items SET triaged = 1, triage_result = ? WHERE id = ?",
      [result, id],
    );
    set({
      inboxItems: get().inboxItems.map((i) =>
        i.id === id ? { ...i, triaged: true, triage_result: result } : i,
      ),
    });
    await get().enqueueEvent("inbox_item_upsert", {
      id,
      text: prev?.text ?? "",
      triaged: true,
      triage_result: result,
      created_at: prev?.created_at ?? dayjs().toISOString(),
    });
  },

  deleteInboxItem: async (id) => {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM inbox_items WHERE id = ?", [id]);
    set({ inboxItems: get().inboxItems.filter((i) => i.id !== id) });
    await get().enqueueEvent("inbox_item_delete", { id });
  },

  // ── Time Blocks ──

  loadTimeBlocks: async (date) => {
    const db = await getDatabase();
    const d = date ?? dayjs().format("YYYY-MM-DD");
    const rows = await db.getAllAsync<TimeBlock>(
      "SELECT * FROM time_blocks WHERE date = ? ORDER BY start_time ASC",
      [d],
    );
    set({ timeBlocks: rows });
  },

  addTimeBlock: async (
    title,
    startTime,
    endTime,
    date,
    source = "manual",
    taskId,
    color = "#5a8f86",
  ) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      "INSERT INTO time_blocks (id, title, start_time, end_time, source, task_id, color, date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, title, startTime, endTime, source, taskId ?? null, color, date, now],
    );
    const block: TimeBlock = {
      id,
      title,
      start_time: startTime,
      end_time: endTime,
      source,
      task_id: taskId ?? null,
      color,
      date,
      created_at: now,
    };
    set({
      timeBlocks: [...get().timeBlocks, block].sort((a, b) =>
        a.start_time.localeCompare(b.start_time),
      ),
    });
  },

  updateTimeBlock: async (id, fields) => {
    const db = await getDatabase();
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (k !== "id" && k !== "created_at") {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    if (sets.length === 0) return;
    vals.push(id);
    await db.runAsync(
      `UPDATE time_blocks SET ${sets.join(", ")} WHERE id = ?`,
      vals as string[],
    );
    set({
      timeBlocks: get().timeBlocks.map((b) =>
        b.id === id ? { ...b, ...fields } : b,
      ),
    });
  },

  deleteTimeBlock: async (id) => {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM time_blocks WHERE id = ?", [id]);
    set({ timeBlocks: get().timeBlocks.filter((b) => b.id !== id) });
  },

  // ── Expenses ──

  loadExpenses: async () => {
    const db = await getDatabase();
    const monthStart = dayjs().startOf("month").format("YYYY-MM-DD");
    const todayStr = dayjs().format("YYYY-MM-DD");
    const rows = await db.getAllAsync<Expense>(
      "SELECT * FROM expenses WHERE date >= ? ORDER BY date DESC",
      [monthStart],
    );
    const todaySpend = rows
      .filter((e) => e.date === todayStr)
      .reduce((s, e) => s + e.amount, 0);
    const monthSpend = rows.reduce((s, e) => s + e.amount, 0);
    set({ expenses: rows, todaySpend, monthSpend });
  },

  addExpense: async (amount, category, description, date) => {
    const db = await getDatabase();
    const id = uid();
    const d = date ?? dayjs().format("YYYY-MM-DD");
    const now = dayjs().toISOString();
    await db.runAsync(
      "INSERT INTO expenses (id, amount, category, description, date, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, amount, category, description ?? null, d, now],
    );
    const expense: Expense = {
      id,
      amount,
      currency: "USD",
      category,
      description: description ?? null,
      date: d,
      created_at: now,
    };
    const todayStr = dayjs().format("YYYY-MM-DD");
    set({
      expenses: [expense, ...get().expenses],
      todaySpend: d === todayStr ? get().todaySpend + amount : get().todaySpend,
      monthSpend: get().monthSpend + amount,
    });
    ftsIndex("expense", id, description ?? "", `${amount}`, category, d);
    await get().enqueueEvent("expense_upsert", {
      id,
      amount,
      currency: "USD",
      category,
      description: description ?? null,
      date: d,
      created_at: now,
    });
  },

  deleteExpense: async (id) => {
    const db = await getDatabase();
    const expense = get().expenses.find((e) => e.id === id);
    await db.runAsync("DELETE FROM expenses WHERE id = ?", [id]);
    const todayStr = dayjs().format("YYYY-MM-DD");
    set({
      expenses: get().expenses.filter((e) => e.id !== id),
      todaySpend:
        expense && expense.date === todayStr
          ? get().todaySpend - expense.amount
          : get().todaySpend,
      monthSpend: expense
        ? get().monthSpend - expense.amount
        : get().monthSpend,
    });
    ftsRemove(id);
  },

  loadBudgets: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<Budget>("SELECT * FROM budgets");
    set({ budgets: rows });
  },

  setBudget: async (category, monthlyLimit) => {
    const db = await getDatabase();
    const existing = get().budgets.find((b) => b.category === category);
    if (existing) {
      await db.runAsync("UPDATE budgets SET monthly_limit = ? WHERE id = ?", [
        monthlyLimit,
        existing.id,
      ]);
      set({
        budgets: get().budgets.map((b) =>
          b.id === existing.id ? { ...b, monthly_limit: monthlyLimit } : b,
        ),
      });
      await get().enqueueEvent("budget_upsert", {
        id: existing.id,
        category,
        monthly_limit: monthlyLimit,
        currency: "USD",
        created_at: existing.created_at,
      });
    } else {
      const id = uid();
      const now = dayjs().toISOString();
      await db.runAsync(
        "INSERT INTO budgets (id, category, monthly_limit, created_at) VALUES (?, ?, ?, ?)",
        [id, category, monthlyLimit, now],
      );
      set({
        budgets: [
          ...get().budgets,
          {
            id,
            category,
            monthly_limit: monthlyLimit,
            currency: "USD",
            created_at: now,
          },
        ],
      });
      await get().enqueueEvent("budget_upsert", {
        id,
        category,
        monthly_limit: monthlyLimit,
        currency: "USD",
        created_at: now,
      });
    }
  },

  loadUserProfile: async () => {
    const db = await getDatabase();
    const profileRow = await db.getFirstAsync<UserProfile>(
      "SELECT * FROM user_profile WHERE id = 'default' LIMIT 1",
    );
    const weightLogs = await db.getAllAsync<WeightLog>(
      "SELECT * FROM weight_log ORDER BY date DESC LIMIT 100",
    );
    set({ userProfile: profileRow ?? null, weightLogs });
  },

  setUserProfile: (partial) => {
    const current = get().userProfile;
    const base: UserProfile = current ?? {
      id: "default",
      weight_kg: null,
      height_cm: null,
      birth_date: null,
      gender: null,
      activity_level: null,
      target_weight_kg: null,
      target_date: null,
      goal_type: null,
      day_outline: null,
      activity_prefs: null,
      typical_wake_time: null,
      leave_home_time: null,
      work_start_time: null,
      typical_bedtime: null,
      day_coach_enabled: 1,
      created_at: dayjs().toISOString(),
      updated_at: dayjs().toISOString(),
    };
    set({
      userProfile: { ...base, ...partial, updated_at: dayjs().toISOString() },
    });
  },

  saveUserProfile: async () => {
    const db = await getDatabase();
    const p = get().userProfile;
    if (!p) return;
    const now = dayjs().toISOString();
    await db.runAsync(
      `INSERT INTO user_profile (id, weight_kg, height_cm, birth_date, gender, activity_level, target_weight_kg, target_date, goal_type,
        day_outline, activity_prefs, typical_wake_time, leave_home_time, work_start_time, typical_bedtime, day_coach_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         weight_kg=excluded.weight_kg, height_cm=excluded.height_cm, birth_date=excluded.birth_date,
         gender=excluded.gender, activity_level=excluded.activity_level,
         target_weight_kg=excluded.target_weight_kg, target_date=excluded.target_date, goal_type=excluded.goal_type,
         day_outline=excluded.day_outline, activity_prefs=excluded.activity_prefs,
         typical_wake_time=excluded.typical_wake_time, leave_home_time=excluded.leave_home_time,
         work_start_time=excluded.work_start_time, typical_bedtime=excluded.typical_bedtime,
         day_coach_enabled=excluded.day_coach_enabled,
         updated_at=excluded.updated_at`,
      [
        p.id,
        p.weight_kg ?? null,
        p.height_cm ?? null,
        p.birth_date ?? null,
        p.gender ?? null,
        p.activity_level ?? null,
        p.target_weight_kg ?? null,
        p.target_date ?? null,
        p.goal_type ?? null,
        p.day_outline ?? null,
        p.activity_prefs ?? null,
        p.typical_wake_time ?? null,
        p.leave_home_time ?? null,
        p.work_start_time ?? null,
        p.typical_bedtime ?? null,
        p.day_coach_enabled ?? 1,
        p.created_at ?? now,
        now,
      ],
    );
    try {
      const { registerDayProfileNotifications } = await import(
        "../services/dayProfileNotifications"
      );
      await registerDayProfileNotifications();
    } catch {
      /* ignore */
    }
  },

  addWeightLog: async (date, weightKg) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      "INSERT INTO weight_log (id, date, weight_kg, created_at) VALUES (?, ?, ?, ?)",
      [id, date, weightKg, now],
    );
    const log: WeightLog = { id, date, weight_kg: weightKg, created_at: now };
    set({ weightLogs: [log, ...get().weightLogs] });
  },

  // ── AI Memory (dedup by normalized fact, cap at MAX_AI_MEMORIES) ──
  addAiMemory: async (
    fact,
    category = "general",
    sourceCmdId,
    expiresAt,
    tier = "persistent",
  ) => {
    const MAX_AI_MEMORIES = 100;
    const existing = get().aiMemories;
    const normalized = fact.toLowerCase().trim();
    if (!normalized) return;
    if (existing.some((m) => m.fact.toLowerCase().trim() === normalized))
      return;

    if (tier === "ephemeral") {
      const existingEphemeral = get().ephemeralMemories;
      if (!existingEphemeral.includes(fact)) {
        set({ ephemeralMemories: [fact, ...existingEphemeral].slice(0, 30) });
      }
      return;
    }

    const db = await getDatabase();
    const id = uid();
    await db.runAsync(
      "INSERT INTO ai_memory (id, fact, category, source_cmd_id, expires_at) VALUES (?,?,?,?,?)",
      [id, fact, category, sourceCmdId ?? null, expiresAt ?? null],
    );
    const mem: AiMemory = {
      id,
      fact,
      category,
      source_cmd_id: sourceCmdId ?? null,
      created_at: dayjs().toISOString(),
      expires_at: expiresAt ?? null,
    };
    let updated = [mem, ...existing];

    if (updated.length > MAX_AI_MEMORIES) {
      const toDelete = updated.splice(MAX_AI_MEMORIES);
      const ids = toDelete.map((m) => `'${m.id}'`).join(",");
      db.runAsync(`DELETE FROM ai_memory WHERE id IN (${ids})`).catch(() => {});
    }

    set({ aiMemories: updated });
    ftsIndex("memory", id, fact, "", category, dayjs().toISOString());
  },

  deleteAiMemory: async (id) => {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM ai_memory WHERE id = ?", [id]);
    set({ aiMemories: get().aiMemories.filter((m) => m.id !== id) });
    ftsRemove(id);
  },

  updateAiMemory: async (id, fact) => {
    const db = await getDatabase();
    await db.runAsync("UPDATE ai_memory SET fact = ? WHERE id = ?", [fact, id]);
    set({
      aiMemories: get().aiMemories.map((m) =>
        m.id === id ? { ...m, fact } : m,
      ),
    });
    ftsIndex("memory", id, fact, "", "general", dayjs().toISOString());
  },

  loadAiMemories: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<AiMemory>(
      "SELECT * FROM ai_memory WHERE expires_at IS NULL OR expires_at > datetime('now') ORDER BY created_at DESC LIMIT 100",
    );
    set({ aiMemories: rows });
  },

  getMemoryFacts: () => {
    return [...get().ephemeralMemories, ...get().aiMemories.map((m) => m.fact)];
  },

  setCheckinIntervalMin: (minutes) => {
    kv.set("proactive_checkin_interval_min", minutes);
    set({ checkinIntervalMin: minutes });
    import("../db/database").then(({ saveAppSettings }) =>
      saveAppSettings({ proactive_checkin_interval_min: minutes }).catch((e) =>
        console.warn("[LifeOS] saveAppSettings failed:", e),
      ),
    );
  },

  setProactiveQuietHours: (afterHour, beforeHour) => {
    kv.set("proactive_quiet_after_hour", afterHour);
    kv.set("proactive_quiet_before_hour", beforeHour);
    set({
      proactiveQuietAfterHour: afterHour,
      proactiveQuietBeforeHour: beforeHour,
    });
    import("../db/database").then(({ saveAppSettings }) =>
      saveAppSettings({
        proactive_quiet_after_hour: afterHour,
        proactive_quiet_before_hour: beforeHour,
      }).catch((e) => console.warn("[LifeOS] saveAppSettings failed:", e)),
    );
  },

  loadSeenPackages: () => {
    const raw = kv.getString("seen_notif_packages");
    set({ seenNotifPackages: raw ? JSON.parse(raw) : [] });
  },

  setAllowedNotifPackages: (packages) => {
    kv.set("allowed_notif_packages", JSON.stringify(packages));
    set({ allowedNotifPackages: packages });
    // Update native module filter
    try {
      const mod = require("expo-android-notification-listener-service").default;
      if (packages.length > 0) {
        mod.setAllowedPackages(packages);
      }
    } catch {
      /* module not available */
    }
  },
  promoteEphemeralMemory: async (fact, category = "general") => {
    await get().addAiMemory(fact, category, undefined, undefined, "persistent");
    set({
      ephemeralMemories: get().ephemeralMemories.filter((f) => f !== fact),
    });
  },
  clearEphemeralMemories: () => {
    set({ ephemeralMemories: [] });
  },
  setApprovalMode: (mode, domain) => {
    if (!domain) {
      kv.set("agent_approval_default", mode);
      set({ agentDefaultApprovalMode: mode });
      return;
    }
    const next = { ...get().agentDomainApprovalModes, [domain]: mode };
    kv.set("agent_approval_domains", JSON.stringify(next));
    set({ agentDomainApprovalModes: next });
  },
  enqueueAgentApproval: async (tool, params, source) => {
    const id = uid();
    const row = { id, tool, params, source, created_at: new Date().toISOString() };
    set({ agentPendingApprovals: [row, ...get().agentPendingApprovals] });
    return id;
  },
  resolveAgentApproval: async (id, approved) => {
    const row = get().agentPendingApprovals.find((a) => a.id === id);
    if (!row) return { ok: false, message: "Approval request not found." };
    set({
      agentPendingApprovals: get().agentPendingApprovals.filter((a) => a.id !== id),
    });
    if (!approved) return { ok: false, message: "Action denied." };
    const { executeToolWithGoalContext } = await import("../agent/tools");
    const result = await executeToolWithGoalContext(row.tool, row.params);
    return { ok: result.success, message: result.message };
  },
  setAgentPolicy: (partial) => {
    const next = { ...get().agentPolicy, ...partial };
    kv.set("agent_policy", JSON.stringify(next));
    set({ agentPolicy: next });
  },
  setSimulationMode: (enabled) => {
    kv.set("agent_simulation_mode", enabled ? "1" : "0");
    set({ simulationMode: enabled });
  },
  setHeyZarbieConfig: (partial) => {
    const current = {
      enabled: get().heyZarbieEnabled,
      onlyWhenCharging: get().heyZarbieOnlyWhenCharging,
      pauseOnLowBattery: get().heyZarbiePauseOnLowBattery,
      sensitivity: get().heyZarbieSensitivity,
      launchBehavior: get().heyZarbieLaunchBehavior,
    };
    const next = { ...current, ...partial };
    kv.set("hey_zarbie_enabled", next.enabled ? "1" : "0");
    kv.set("hey_zarbie_only_charging", next.onlyWhenCharging ? "1" : "0");
    kv.set("hey_zarbie_pause_low_battery", next.pauseOnLowBattery ? "1" : "0");
    kv.set("hey_zarbie_sensitivity", next.sensitivity);
    kv.set("hey_zarbie_launch_behavior", next.launchBehavior);
    set({
      heyZarbieEnabled: next.enabled,
      heyZarbieOnlyWhenCharging: next.onlyWhenCharging,
      heyZarbiePauseOnLowBattery: next.pauseOnLowBattery,
      heyZarbieSensitivity: next.sensitivity,
      heyZarbieLaunchBehavior: next.launchBehavior,
    });
  },
  setHeyZarbieConsent: (granted) => {
    kv.set("hey_zarbie_consent_granted", granted ? "1" : "0");
    set({ heyZarbieConsentGranted: granted });
  },
  setLocationContext: (enabled) => {
    kv.set("location_context_enabled", enabled ? "1" : "0");
    set({ locationContextEnabled: enabled });
  },
  updateLastKnownLocation: (lat, lng) => {
    const next = { lat, lng, ts: new Date().toISOString() };
    kv.set("last_known_location", JSON.stringify(next));
    set({ lastKnownLocation: next });
  },
  upsertGeofencePlace: (place) => {
    const id = place.id ?? uid();
    const row = {
      id,
      name: place.name,
      lat: place.lat,
      lng: place.lng,
      radius_m: place.radius_m ?? 150,
      reminder_text: place.reminder_text,
    };
    const next = [...get().geofencePlaces.filter((p) => p.id !== id), row];
    kv.set("geofence_places", JSON.stringify(next));
    set({ geofencePlaces: next });
  },
  removeGeofencePlace: (id) => {
    const next = get().geofencePlaces.filter((p) => p.id !== id);
    kv.set("geofence_places", JSON.stringify(next));
    set({ geofencePlaces: next });
  },

  // ── Partner ──
  setPartnerStatus: (partnerId, online, lastSeen) => {
    const partners = get().partners;
    const existing = partners.find((p) => p.id === partnerId);
    if (existing) {
      set({
        partners: partners.map((p) =>
          p.id === partnerId ? { ...p, online, lastSeen } : p,
        ),
      });
    } else {
      set({
        partners: [
          ...partners,
          { id: partnerId, name: `Partner`, online, lastSeen },
        ],
      });
    }
  },

  sendSnippet: async (partnerId, content) => {
    const db = await getDatabase();
    const snippetId = uid();
    const ts = dayjs().toISOString();

    // Write to SQLite first (offline-first)
    await db.runAsync(
      "INSERT INTO partner_snippets (snippet_id, partner_id, content, timestamp, synced) VALUES (?,?,?,?,0)",
      [snippetId, partnerId, content, ts],
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
        const { mqttService } = await import("../services/mqtt");
        const published = mqttService.publishSnippet(partnerId, content);
        if (published) {
          await db.runAsync(
            "UPDATE partner_snippets SET synced = 1 WHERE snippet_id = ?",
            [snippetId],
          );
          set({
            partnerSnippets: get().partnerSnippets.map((s) =>
              s.snippet_id === snippetId ? { ...s, synced: true } : s,
            ),
          });
          return;
        }
      } catch {
        /* fall through to queue */
      }
    }

    // Queue for later sync
    await get().enqueueEvent("mqtt_publish", {
      topic: `partner/snippet/${partnerId}`,
      content,
    });
  },

  loadPartnerSnippets: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<PartnerSnippet>(
      "SELECT * FROM partner_snippets ORDER BY timestamp DESC LIMIT 50",
    );
    set({ partnerSnippets: rows.map((s) => ({ ...s, synced: !!s.synced })) });
  },

  // ── Google integration ──
  setGoogleConnected: (connected, email) => {
    kv.set("google_connected", connected);
    if (email !== undefined) {
      if (email) kv.set("google_email", email);
      else kv.delete("google_email");
    }
    set({
      isGoogleConnected: connected,
      googleEmail: email ?? (connected ? get().googleEmail : null),
    });
  },

  setMicrosoftConnected: (connected, email) => {
    kv.set("microsoft_connected", connected);
    if (email !== undefined) {
      if (email) kv.set("microsoft_email", email);
      else kv.delete("microsoft_email");
    }
    set({
      isMicrosoftConnected: connected,
      microsoftEmail: email ?? (connected ? get().microsoftEmail : null),
    });
  },

  syncCalendarEvents: async () => {
    if (get().calendarSyncing) return;
    set({ calendarSyncing: true, lastCalendarError: null });
    try {
      const { googleCalendar } = await import("../services/google-calendar");
      // Fetch 2 weeks so "today", "tomorrow", "week" and newly created events are included
      const result = await googleCalendar.listEvents(
        dayjs().startOf("day").toISOString(),
        dayjs().add(14, "day").endOf("day").toISOString(),
        100,
      );
      if (!result.ok) {
        set({
          calendarSyncing: false,
          lastCalendarError: result.error ?? "Calendar sync failed",
        });
        return;
      }

      const db = await getDatabase();
      const now = dayjs().toISOString();

      for (const ev of result.data) {
        const startTime = ev.start.dateTime ?? ev.start.date ?? "";
        const endTime = ev.end.dateTime ?? ev.end.date ?? "";
        const allDay = !ev.start.dateTime;
        await db.runAsync(
          `INSERT OR REPLACE INTO calendar_events (event_id,summary,description,location,start_time,end_time,all_day,status,html_link,google_calendar_id,synced_at,raw_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            ev.id,
            ev.summary,
            ev.description ?? null,
            ev.location ?? null,
            startTime,
            endTime,
            allDay ? 1 : 0,
            ev.status,
            ev.htmlLink ?? null,
            "primary",
            now,
            JSON.stringify(ev),
          ],
        );
        await get().enqueueEvent("calendar_event_upsert", {
          event_id: ev.id,
          summary: ev.summary,
          description: ev.description ?? null,
          location: ev.location ?? null,
          start_time: startTime,
          end_time: endTime,
          all_day: allDay,
          status: ev.status,
          html_link: ev.htmlLink ?? null,
          google_calendar_id: "primary",
          synced_at: now,
          raw_json: JSON.stringify(ev),
        });
      }

      await get().loadCalendarEvents();
      const nowIso = dayjs().toISOString();
      set({
        calendarSyncing: false,
        calendarLastSynced: nowIso,
        lastCalendarError: null,
      });

      const merged = get().calendarEvents;
      const upcoming = merged
        .filter((e) => !e.all_day && dayjs(e.start_time).isAfter(dayjs()))
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
      if (upcoming.length > 0) {
        const next = upcoming[0];
        kv.set(
          "widget_next_event",
          `${dayjs(next.start_time).format("h:mm A")} ${next.summary}`,
        );
      } else {
        kv.delete("widget_next_event");
      }
    } catch (e) {
      set({ calendarSyncing: false, lastCalendarError: (e as Error).message });
    }
  },

  syncMicrosoftCalendarEvents: async () => {
    if (!get().isMicrosoftConnected) return;
    if (get().calendarSyncing) return;
    set({ calendarSyncing: true, lastCalendarError: null });
    try {
      const { microsoftCalendar } = await import("../services/microsoft-calendar");
      const start = dayjs().startOf("day").toISOString();
      const end = dayjs().add(14, "day").endOf("day").toISOString();
      const result = await microsoftCalendar.listEvents(start, end, 100);
      if (!result.ok) {
        set({
          calendarSyncing: false,
          lastCalendarError: result.error ?? "Microsoft calendar sync failed",
        });
        return;
      }

      const db = await getDatabase();
      const now = dayjs().toISOString();

      await db.runAsync("DELETE FROM calendar_events WHERE event_id LIKE 'ms-%'");

      for (const ev of result.data) {
        const startTime = ev.start.dateTime ?? ev.start.date ?? "";
        const endTime = ev.end.dateTime ?? ev.end.date ?? "";
        const allDay = !!(ev.isAllDay || !ev.start.dateTime);
        const eid = `ms-${ev.id}`;
        await db.runAsync(
          `INSERT OR REPLACE INTO calendar_events (event_id,summary,description,location,start_time,end_time,all_day,status,html_link,google_calendar_id,synced_at,raw_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            eid,
            ev.subject || "(no title)",
            null,
            null,
            startTime,
            endTime,
            allDay ? 1 : 0,
            ev.showAs ?? "confirmed",
            ev.webLink ?? null,
            "microsoft",
            now,
            JSON.stringify(ev),
          ],
        );
        await get().enqueueEvent("calendar_event_upsert", {
          event_id: eid,
          summary: ev.subject || "(no title)",
          description: null,
          location: null,
          start_time: startTime,
          end_time: endTime,
          all_day: allDay,
          status: ev.showAs ?? "confirmed",
          html_link: ev.webLink ?? null,
          google_calendar_id: "microsoft",
          synced_at: now,
          raw_json: JSON.stringify(ev),
        });
      }

      await get().loadCalendarEvents();
      set({
        calendarSyncing: false,
        calendarLastSynced: dayjs().toISOString(),
        lastCalendarError: null,
      });

      const merged = get().calendarEvents;
      const upcoming = merged
        .filter((e) => !e.all_day && dayjs(e.start_time).isAfter(dayjs()))
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
      if (upcoming.length > 0) {
        const next = upcoming[0];
        kv.set(
          "widget_next_event",
          `${dayjs(next.start_time).format("h:mm A")} ${next.summary}`,
        );
      }
    } catch (e) {
      set({ calendarSyncing: false, lastCalendarError: (e as Error).message });
    }
  },

  loadCalendarEvents: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      event_id: string;
      summary: string;
      description: string;
      location: string;
      start_time: string;
      end_time: string;
      all_day: number;
      status: string;
      html_link: string;
      google_calendar_id: string;
      synced_at: string;
    }>("SELECT * FROM calendar_events ORDER BY start_time ASC");
    set({
      calendarEvents: rows.map((r) => ({
        ...r,
        all_day: !!r.all_day,
        description: r.description || null,
        location: r.location || null,
        html_link: r.html_link || null,
      })),
    });
  },

  addCalendarEvent: async (event) => {
    const { googleCalendar } = await import("../services/google-calendar");
    const result = await googleCalendar.createEvent(event);
    if (!result.ok)
      return { ok: false, error: result.error ?? "Failed to create event" };
    await get().syncCalendarEvents();
    return { ok: true };
  },

  updateCalendarEvent: async (eventId, fields) => {
    const { googleCalendar } = await import("../services/google-calendar");
    const result = await googleCalendar.updateEvent(eventId, fields);
    if (result.ok) {
      await get().syncCalendarEvents();
    }
  },

  deleteCalendarEvent: async (eventId) => {
    const { googleCalendar } = await import("../services/google-calendar");
    const result = await googleCalendar.deleteEvent(eventId);
    if (result.ok) {
      const db = await getDatabase();
      await db.runAsync("DELETE FROM calendar_events WHERE event_id = ?", [
        eventId,
      ]);
      set({
        calendarEvents: get().calendarEvents.filter(
          (e) => e.event_id !== eventId,
        ),
      });
      await get().enqueueEvent("calendar_event_delete", { event_id: eventId });
    }
  },

  syncEmails: async () => {
    if (get().emailSyncing) return;
    set({ emailSyncing: true, lastEmailError: null });
    try {
      const { googleGmail } = await import("../services/google-gmail");
      const listResult = await googleGmail.listMessages(
        "is:unread in:inbox",
        20,
      );
      if (!listResult.ok) {
        set({
          emailSyncing: false,
          lastEmailError: listResult.error ?? "Email sync failed",
        });
        return;
      }

      const metaResult = await googleGmail.getMessagesMeta(listResult.data);
      if (!metaResult.ok) {
        set({
          emailSyncing: false,
          lastEmailError: metaResult.error ?? "Email sync failed",
        });
        return;
      }

      const db = await getDatabase();
      const now = dayjs().toISOString();
      const cached: CachedEmail[] = [];
      const existing = await db.getAllAsync<{ message_id: string }>(
        "SELECT message_id FROM email_cache",
      );
      const existingIds = new Set(existing.map((r) => r.message_id));
      const fetchedIds = new Set(metaResult.data.map((m) => m.id));

      for (const oldId of existingIds) {
        if (!fetchedIds.has(oldId)) {
          await db.runAsync("DELETE FROM email_cache WHERE message_id = ?", [oldId]);
          await db.runAsync("DELETE FROM email_categories WHERE message_id = ?", [oldId]);
          await get().enqueueEvent("email_delete", { message_id: oldId });
        }
      }

      for (const meta of metaResult.data) {
        await db.runAsync(
          `INSERT OR REPLACE INTO email_cache (message_id,thread_id,from_address,subject,snippet,date,is_unread,is_starred,label_ids,synced_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            meta.id,
            meta.threadId,
            meta.from,
            meta.subject,
            meta.snippet,
            meta.date,
            meta.isUnread ? 1 : 0,
            meta.isStarred ? 1 : 0,
            JSON.stringify(meta.labelIds),
            now,
          ],
        );
        cached.push({
          message_id: meta.id,
          thread_id: meta.threadId,
          from_address: meta.from,
          subject: meta.subject,
          snippet: meta.snippet,
          date: meta.date,
          is_unread: meta.isUnread,
          is_starred: meta.isStarred,
          label_ids: meta.labelIds,
          category: null,
          extracted_tasks: [],
        });
        await get().enqueueEvent("email_upsert", {
          message_id: meta.id,
          thread_id: meta.threadId,
          from_address: meta.from,
          subject: meta.subject,
          snippet: meta.snippet,
          date: meta.date,
          is_unread: meta.isUnread,
          is_starred: meta.isStarred,
          label_ids: JSON.stringify(meta.labelIds ?? []),
          synced_at: now,
        });
      }

      set({
        emails: cached,
        emailSyncing: false,
        emailLastSynced: now,
        lastEmailError: null,
        unreadEmailCount: cached.filter((e) => e.is_unread).length,
      });
    } catch (e) {
      set({ emailSyncing: false, lastEmailError: (e as Error).message });
    }
  },

  loadEmails: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      message_id: string;
      thread_id: string;
      from_address: string;
      subject: string;
      snippet: string;
      date: string;
      is_unread: number;
      is_starred: number;
      label_ids: string;
      body_text: string;
    }>("SELECT * FROM email_cache ORDER BY date DESC LIMIT 50");
    const catRows = await db.getAllAsync<{
      message_id: string;
      category: string;
      extracted_tasks: string;
    }>("SELECT * FROM email_categories");
    const catMap = new Map(catRows.map((r) => [r.message_id, r]));
    const emails: CachedEmail[] = rows.map((r) => {
      const cat = catMap.get(r.message_id);
      return {
        message_id: r.message_id,
        thread_id: r.thread_id,
        from_address: r.from_address,
        subject: r.subject,
        snippet: r.snippet || "",
        date: r.date,
        is_unread: !!r.is_unread,
        is_starred: !!r.is_starred,
        label_ids: r.label_ids ? JSON.parse(r.label_ids) : [],
        category: (cat?.category as CachedEmail["category"]) ?? null,
        extracted_tasks: cat?.extracted_tasks
          ? JSON.parse(cat.extracted_tasks)
          : [],
      };
    });
    set({ emails, unreadEmailCount: emails.filter((e) => e.is_unread).length });
  },

  triageEmails: async () => {
    const { categorizeEmail } = await import("../services/google-gmail");
    const db = await getDatabase();
    const now = dayjs().toISOString();
    const updated = get().emails.map((email) => {
      const category = categorizeEmail({
        id: email.message_id,
        threadId: email.thread_id,
        snippet: email.snippet,
        from: email.from_address,
        subject: email.subject,
        date: email.date,
        isUnread: email.is_unread,
        isStarred: email.is_starred,
        labelIds: email.label_ids,
      });
      return { ...email, category };
    });

    for (const email of updated) {
      if (email.category) {
        await db.runAsync(
          `INSERT OR REPLACE INTO email_categories (message_id,category,extracted_tasks,categorized_at) VALUES (?,?,?,?)`,
          [
            email.message_id,
            email.category,
            JSON.stringify(email.extracted_tasks),
            now,
          ],
        );
        await get().enqueueEvent("email_category_upsert", {
          message_id: email.message_id,
          category: email.category,
          extracted_tasks: JSON.stringify(email.extracted_tasks ?? []),
          categorized_at: now,
        });
      }
    }
    set({ emails: updated });
  },

  markEmailRead: async (messageId) => {
    const { googleGmail } = await import("../services/google-gmail");
    const result = await googleGmail.markAsRead(messageId);
    if (result.ok) {
      const db = await getDatabase();
      await db.runAsync(
        "UPDATE email_cache SET is_unread = 0 WHERE message_id = ?",
        [messageId],
      );
      const emails = get().emails.map((e) =>
        e.message_id === messageId ? { ...e, is_unread: false } : e,
      );
      set({
        emails,
        unreadEmailCount: emails.filter((e) => e.is_unread).length,
      });
    }
  },

  toggleEmailStar: async (messageId, starred) => {
    const { googleGmail } = await import("../services/google-gmail");
    const result = await googleGmail.toggleStar(messageId, starred);
    if (result.ok) {
      const db = await getDatabase();
      await db.runAsync(
        "UPDATE email_cache SET is_starred = ? WHERE message_id = ?",
        [starred ? 1 : 0, messageId],
      );
      set({
        emails: get().emails.map((e) =>
          e.message_id === messageId ? { ...e, is_starred: starred } : e,
        ),
      });
    }
  },

  extractTasksFromEmails: async () => {
    const { extractTasksFromEmail } = await import("../services/google-gmail");
    const { googleGmail } = await import("../services/google-gmail");
    const db = await getDatabase();
    const now = dayjs().toISOString();
    const actionEmails = get().emails.filter(
      (e) => e.category === "action_needed" || e.category === "important",
    );
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
          [
            email.message_id,
            email.category ?? "fyi",
            JSON.stringify(tasks),
            now,
          ],
        );
        set({
          emails: get().emails.map((e) =>
            e.message_id === email.message_id ? updated : e,
          ),
        });
      }
    }

    // Create tasks from extracted items
    for (const taskTitle of [...new Set(allTasks)].slice(0, 10)) {
      await get().addTask(taskTitle, "medium", null, "Extracted from email");
    }

    return allTasks;
  },

  // ── PicoClaw — Routines ──
  loadRoutines: async () => {
    const db = await getDatabase();
    const { parseRoutineRow } = await import("../agent/routines");
    const rows = await db.getAllAsync<{
      id: string;
      name: string;
      trigger_phrases: string;
      steps: string;
      enabled: number;
      created_at: string;
    }>("SELECT * FROM routines WHERE enabled = 1");
    set({ routines: rows.map(parseRoutineRow) });
  },

  addRoutine: async (name, triggerPhrases, steps) => {
    const db = await getDatabase();
    const id = uid();
    const now = dayjs().toISOString();
    await db.runAsync(
      "INSERT INTO routines (id, name, trigger_phrases, steps, enabled, created_at) VALUES (?,?,?,?,1,?)",
      [id, name, JSON.stringify(triggerPhrases), JSON.stringify(steps), now],
    );
    const routine = {
      id,
      name,
      triggerPhrases,
      steps,
      enabled: true,
      createdAt: now,
    };
    set({ routines: [...get().routines, routine] });
  },

  deleteRoutine: async (id) => {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM routines WHERE id = ?", [id]);
    set({ routines: get().routines.filter((r) => r.id !== id) });
  },

  // ── PicoClaw — Automation Rules ──
  loadAutomationRules: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      id: string;
      name: string;
      description: string;
      rule_type: string;
      schedule: string;
      condition: string;
      actions: string;
      enabled: number;
      last_triggered: string;
      created_at: string;
    }>("SELECT * FROM automation_rules");
    set({
      automationRules: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description || "",
        ruleType: r.rule_type as "schedule" | "condition",
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
      "INSERT INTO automation_rules (id,name,description,rule_type,schedule,condition,actions,enabled,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        id,
        rule.name,
        rule.description,
        rule.ruleType,
        rule.schedule ?? null,
        rule.condition ?? null,
        JSON.stringify(rule.actions),
        rule.enabled ? 1 : 0,
        now,
      ],
    );
    set({
      automationRules: [
        ...get().automationRules,
        { ...rule, id, createdAt: now, lastTriggered: null },
      ],
    });
  },

  updateAutomationRule: async (id, fields) => {
    const db = await getDatabase();
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.name !== undefined) {
      sets.push("name = ?");
      vals.push(fields.name);
    }
    if (fields.description !== undefined) {
      sets.push("description = ?");
      vals.push(fields.description);
    }
    if (fields.schedule !== undefined) {
      sets.push("schedule = ?");
      vals.push(fields.schedule);
    }
    if (fields.condition !== undefined) {
      sets.push("condition = ?");
      vals.push(fields.condition);
    }
    if (fields.actions !== undefined) {
      sets.push("actions = ?");
      vals.push(JSON.stringify(fields.actions));
    }
    if (fields.enabled !== undefined) {
      sets.push("enabled = ?");
      vals.push(fields.enabled ? 1 : 0);
    }
    if (fields.lastTriggered !== undefined) {
      sets.push("last_triggered = ?");
      vals.push(fields.lastTriggered);
    }
    if (sets.length === 0) return;
    vals.push(id);
    await db.runAsync(
      `UPDATE automation_rules SET ${sets.join(", ")} WHERE id = ?`,
      vals as string[],
    );
    set({
      automationRules: get().automationRules.map((r) =>
        r.id === id ? { ...r, ...fields } : r,
      ),
    });
  },

  deleteAutomationRule: async (id) => {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM automation_rules WHERE id = ?", [id]);
    set({ automationRules: get().automationRules.filter((r) => r.id !== id) });
  },

  // ── Agentic system state ────────────────────────────
  goals: [],
  plans: [],
  agentActions: [],
  patterns: [],
  watcherQueue: [],
  coachingCommitments: [],

  // Goal CRUD
  loadGoals: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<any>("SELECT * FROM goals WHERE status = 'active' ORDER BY created_at DESC");
    set({
      goals: rows.map((r: any) => ({
        id: r.id, title: r.title, description: r.description, domain: r.domain,
        targetValue: r.target_value, currentValue: r.current_value, unit: r.unit,
        deadline: r.deadline, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
      })),
    });
  },
  addGoal: async (goal) => {
    const db = await getDatabase();
    const id = uid();
    const now = new Date().toISOString();
    await db.runAsync(
      "INSERT INTO goals (id, title, description, domain, target_value, current_value, unit, deadline, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'active', ?, ?)",
      [id, goal.title, goal.description ?? null, goal.domain, goal.targetValue ?? null, goal.unit ?? null, goal.deadline ?? null, now, now],
    );
    set({ goals: [{ ...goal, id, currentValue: 0, status: 'active' as const, createdAt: now, updatedAt: now }, ...get().goals] });
    ftsIndex("goal", id, goal.title, goal.description ?? "", goal.domain, now);
    return id;
  },
  updateGoal: async (id, fields) => {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const sets: string[] = ["updated_at = ?"];
    const vals: any[] = [now];
    if (fields.title !== undefined) { sets.push("title = ?"); vals.push(fields.title); }
    if (fields.description !== undefined) { sets.push("description = ?"); vals.push(fields.description); }
    if (fields.currentValue !== undefined) { sets.push("current_value = ?"); vals.push(fields.currentValue); }
    if (fields.status !== undefined) { sets.push("status = ?"); vals.push(fields.status); }
    if (fields.targetValue !== undefined) { sets.push("target_value = ?"); vals.push(fields.targetValue); }
    if (fields.deadline !== undefined) { sets.push("deadline = ?"); vals.push(fields.deadline); }
    vals.push(id);
    await db.runAsync(`UPDATE goals SET ${sets.join(", ")} WHERE id = ?`, vals);
    set({ goals: get().goals.map((g) => g.id === id ? { ...g, ...fields, updatedAt: now } : g) });
  },
  deleteGoal: async (id) => {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM goals WHERE id = ?", [id]);
    set({ goals: get().goals.filter((g) => g.id !== id) });
  },
  progressGoal: async (id, value) => {
    const goal = get().goals.find((g) => g.id === id);
    if (!goal) return;
    const newValue = goal.currentValue + value;
    const completed = goal.targetValue != null && newValue >= goal.targetValue;
    await get().updateGoal(id, {
      currentValue: newValue,
      ...(completed ? { status: 'completed' as const } : {}),
    });
  },

  // Plan CRUD
  loadPlans: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<any>("SELECT * FROM plans WHERE status IN ('pending','in_progress') ORDER BY created_at DESC");
    set({
      plans: rows.map((r: any) => ({
        id: r.id, goalId: r.goal_id, title: r.title,
        steps: JSON.parse(r.steps || '[]'), status: r.status,
        scheduledFor: r.scheduled_for, createdAt: r.created_at, updatedAt: r.updated_at,
      })),
    });
  },
  addPlan: async (plan) => {
    const db = await getDatabase();
    const id = uid();
    const now = new Date().toISOString();
    await db.runAsync(
      "INSERT INTO plans (id, goal_id, title, steps, status, scheduled_for, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)",
      [id, plan.goalId ?? null, plan.title, JSON.stringify(plan.steps), plan.scheduledFor ?? null, now, now],
    );
    const newPlan = { ...plan, id, status: 'pending' as const, createdAt: now, updatedAt: now };
    set({ plans: [newPlan, ...get().plans] });
    return id;
  },
  updatePlan: async (id, fields) => {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const sets: string[] = ["updated_at = ?"];
    const vals: any[] = [now];
    if (fields.status !== undefined) { sets.push("status = ?"); vals.push(fields.status); }
    if (fields.steps !== undefined) { sets.push("steps = ?"); vals.push(JSON.stringify(fields.steps)); }
    vals.push(id);
    await db.runAsync(`UPDATE plans SET ${sets.join(", ")} WHERE id = ?`, vals);
    set({ plans: get().plans.map((p) => p.id === id ? { ...p, ...fields, updatedAt: now } : p) });
  },
  updatePlanStep: async (planId, stepId, status) => {
    const plan = get().plans.find((p) => p.id === planId);
    if (!plan) return;
    const steps = plan.steps.map((s) => s.id === stepId ? { ...s, status } : s);
    const allDone = steps.every((s) => s.status === 'done' || s.status === 'skipped');
    const anyFailed = steps.some((s) => s.status === 'failed');
    const planStatus = allDone ? 'completed' : anyFailed ? 'failed' : 'in_progress';
    await get().updatePlan(planId, { steps, status: planStatus as any });
  },

  // Agent actions log
  logAgentAction: async (action) => {
    const db = await getDatabase();
    const id = uid();
    const now = new Date().toISOString();
    await db.runAsync(
      "INSERT INTO agent_actions (id, agent, action_type, input, output, goal_id, plan_id, success, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, action.agent, action.actionType, action.input ?? null, action.output ?? null, action.goalId ?? null, action.planId ?? null, action.success != null ? (action.success ? 1 : 0) : null, now],
    );
  },

  // Patterns
  loadPatterns: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<any>("SELECT * FROM behavior_patterns ORDER BY confidence DESC");
    set({
      patterns: rows.map((r: any) => ({
        id: r.id, domain: r.domain, patternType: r.pattern_type,
        description: r.description, data: JSON.parse(r.data || '{}'),
        confidence: r.confidence, sampleCount: r.sample_count,
        lastUpdated: r.last_updated, createdAt: r.created_at,
      })),
    });
  },
  upsertPattern: async (pattern) => {
    const db = await getDatabase();
    const now = new Date().toISOString();
    // Use domain+patternType+description as natural key for upsert
    const existing = get().patterns.find(
      (p) => p.domain === pattern.domain && p.patternType === pattern.patternType && p.description === pattern.description,
    );
    if (existing) {
      await db.runAsync(
        "UPDATE behavior_patterns SET data = ?, confidence = ?, sample_count = ?, last_updated = ? WHERE id = ?",
        [JSON.stringify(pattern.data), pattern.confidence, pattern.sampleCount, now, existing.id],
      );
      set({
        patterns: get().patterns.map((p) =>
          p.id === existing.id ? { ...p, data: pattern.data, confidence: pattern.confidence, sampleCount: pattern.sampleCount, lastUpdated: now } : p,
        ),
      });
      await get().enqueueEvent("behavior_pattern_upsert", {
        id: existing.id,
        domain: pattern.domain,
        pattern_type: pattern.patternType,
        description: pattern.description,
        data: JSON.stringify(pattern.data),
        confidence: pattern.confidence,
        sample_count: pattern.sampleCount,
        last_updated: now,
        created_at: existing.createdAt,
      });
    } else {
      const id = uid();
      await db.runAsync(
        "INSERT INTO behavior_patterns (id, domain, pattern_type, description, data, confidence, sample_count, last_updated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, pattern.domain, pattern.patternType, pattern.description, JSON.stringify(pattern.data), pattern.confidence, pattern.sampleCount, now, now],
      );
      set({ patterns: [...get().patterns, { ...pattern, id, createdAt: now, lastUpdated: now }] });
      await get().enqueueEvent("behavior_pattern_upsert", {
        id,
        domain: pattern.domain,
        pattern_type: pattern.patternType,
        description: pattern.description,
        data: JSON.stringify(pattern.data),
        confidence: pattern.confidence,
        sample_count: pattern.sampleCount,
        last_updated: now,
        created_at: now,
      });
    }
  },

  // Watcher queue
  loadWatcherQueue: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<any>("SELECT * FROM watcher_queue WHERE read = 0 ORDER BY created_at DESC LIMIT 50");
    set({
      watcherQueue: rows.map((r: any) => ({
        id: r.id, domain: r.domain, title: r.title, body: r.body,
        priority: r.priority, read: !!r.read, createdAt: r.created_at,
        suggestedAction: r.suggested_action ? JSON.parse(r.suggested_action) : undefined,
      })),
    });
  },
  addWatcherNotification: async (n) => {
    const db = await getDatabase();
    const ext = n as typeof n & { id?: string };
    const id = ext.id ?? uid();
    const now = new Date().toISOString();
    const { ruleId, id: _ignored, ...rest } = ext;
    void _ignored;
    const suggestedActionJson = rest.suggestedAction
      ? JSON.stringify(rest.suggestedAction)
      : null;
    if (ext.id) {
      const result = await db.runAsync(
        "INSERT OR IGNORE INTO watcher_queue (id, domain, title, body, priority, read, created_at, rule_id, suggested_action) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)",
        [id, rest.domain ?? null, rest.title, rest.body, rest.priority, now, ruleId ?? null, suggestedActionJson],
      );
      const ch = (result as { changes?: number }).changes;
      if (ch !== undefined && ch < 1) return;
    } else {
      await db.runAsync(
        "INSERT INTO watcher_queue (id, domain, title, body, priority, read, created_at, rule_id, suggested_action) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)",
        [id, rest.domain ?? null, rest.title, rest.body, rest.priority, now, ruleId ?? null, suggestedActionJson],
      );
    }
    set({
      watcherQueue: [{ ...rest, id, read: false, createdAt: now }, ...get().watcherQueue],
    });
  },
  markWatcherRead: async (id) => {
    const db = await getDatabase();
    await db.runAsync("UPDATE watcher_queue SET read = 1 WHERE id = ?", [id]);
    set({ watcherQueue: get().watcherQueue.filter((n) => n.id !== id) });
    if (kv.getString("backend_url") && kv.getString("server_coach_enabled") === "1") {
      import("../services/api")
        .then(({ api }) => api.isAuthenticated().then((ok) => (ok ? api.markCoachNotificationsRead([id]) : null)))
        .catch(() => {});
    }
  },
  markRecentWatcherActed: async (withinMinutes = 5) => {
    const db = await getDatabase();
    const since = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
    const rows = await db.getAllAsync<{ id: string }>(
      "SELECT id FROM watcher_queue WHERE read = 0 AND created_at > ? AND acted_on = 0",
      [since],
    );
    if (rows.length === 0) return;
    const ids = rows.map((r) => r.id);
    await db.runAsync(
      `UPDATE watcher_queue SET acted_on = 1 WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    if (kv.getString("backend_url") && kv.getString("server_coach_enabled") === "1") {
      import("../services/api")
        .then(({ api }) =>
          api.isAuthenticated().then((ok) =>
            ok ? api.markCoachNotificationsActed(ids) : null,
          ),
        )
        .catch(() => {});
    }
  },
  executeWatcherSuggestedAction: async (id) => {
    const notif = get().watcherQueue.find((n) => n.id === id);
    if (!notif?.suggestedAction) {
      return { ok: false, message: "No suggested action available." };
    }
    try {
      const { executeToolWithGoalContext } = await import("../agent/tools");
      const result = await executeToolWithGoalContext(
        notif.suggestedAction.tool,
        notif.suggestedAction.params,
      );
      if (result.success) {
        await get().markWatcherRead(id);
        const accepted = (kv.getNumber("agent_outcome_accept_count") ?? 0) + 1;
        kv.set("agent_outcome_accept_count", accepted);
        await get().enqueueEvent("agent_outcome", {
          outcome: "accepted",
          source: "watcher_suggested_action",
          tool: notif.suggestedAction.tool,
          at: new Date().toISOString(),
        });
        return { ok: true, message: result.message };
      }
      const rejected = (kv.getNumber("agent_outcome_reject_count") ?? 0) + 1;
      kv.set("agent_outcome_reject_count", rejected);
      await get().enqueueEvent("agent_outcome", {
        outcome: "rejected",
        source: "watcher_suggested_action",
        tool: notif.suggestedAction.tool,
        at: new Date().toISOString(),
      });
      return { ok: false, message: result.message };
    } catch (e: any) {
      await get().enqueueEvent("agent_outcome", {
        outcome: "error",
        source: "watcher_suggested_action",
        tool: notif?.suggestedAction?.tool ?? "unknown",
        at: new Date().toISOString(),
      });
      return { ok: false, message: e?.message ?? "Failed to run suggested action." };
    }
  },
  syncServerCoachState: async () => {
    try {
      if (!get().isBackendConfigured || kv.getString("server_coach_enabled") !== "1") return;
      const { api } = await import("../services/api");
      if (!(await api.isAuthenticated())) return;

      const notifRes = await api.listCoachNotifications({ unreadOnly: true, limit: 30 });
      if (notifRes.ok && notifRes.data.notifications?.length) {
        const db = await getDatabase();
        for (const raw of notifRes.data.notifications) {
          const nid = raw.id;
          const ruleId = raw.ruleId ?? raw.rule_id ?? null;
          const createdAt = raw.createdAt ?? raw.created_at ?? new Date().toISOString();
          await db.runAsync(
            "INSERT OR IGNORE INTO watcher_queue (id, domain, title, body, priority, read, created_at, rule_id) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
            [
              nid,
              raw.domain ?? "productivity",
              raw.title ?? "",
              raw.body ?? "",
              raw.priority ?? "low",
              createdAt,
              ruleId,
            ],
          );
        }
        await get().loadWatcherQueue();
      }

      const comRes = await api.listCoachingCommitments();
      if (comRes.ok && comRes.data.commitments?.length) {
        const db = await getDatabase();
        for (const c of comRes.data.commitments) {
          const id = c.id;
          const ds = c.dateSuggested ?? c.date_suggested ?? "";
          const dd = c.dateDue ?? c.date_due ?? null;
          const ca = c.createdAt ?? c.created_at ?? new Date().toISOString();
          await db.runAsync(
            "INSERT OR REPLACE INTO coaching_commitments (id, suggestion, reason, date_suggested, date_due, adopted, outcome, created_at) VALUES (?,?,?,?,?,?,?,?)",
            [
              id,
              c.suggestion ?? "",
              c.reason ?? null,
              ds,
              dd,
              c.adopted ? 1 : 0,
              c.outcome ?? null,
              ca,
            ],
          );
        }
        await get().loadCoachingCommitments();
      }
    } catch {
      /* best-effort */
    }
  },
  clearWatcherQueue: async () => {
    const db = await getDatabase();
    await db.runAsync("UPDATE watcher_queue SET read = 1 WHERE read = 0");
    set({ watcherQueue: [] });
  },

  loadCoachingCommitments: async () => {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      id: string;
      suggestion: string;
      reason: string | null;
      date_suggested: string;
      date_due: string | null;
      adopted: number;
      outcome: string | null;
      created_at: string;
    }>("SELECT * FROM coaching_commitments ORDER BY date_suggested DESC LIMIT 50",
    );
    set({
      coachingCommitments: rows.map((r) => ({
        id: r.id,
        suggestion: r.suggestion,
        reason: r.reason,
        dateSuggested: r.date_suggested,
        dateDue: r.date_due,
        adopted: !!r.adopted,
        outcome: r.outcome,
        createdAt: r.created_at,
      })),
    });
  },

  addCoachingCommitment: async (row) => {
    const db = await getDatabase();
    const id = uid();
    const now = new Date().toISOString();
    const adopted = row.adopted ? 1 : 0;
    await db.runAsync(
      "INSERT INTO coaching_commitments (id, suggestion, reason, date_suggested, date_due, adopted, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, row.suggestion, row.reason ?? null, row.dateSuggested, row.dateDue ?? null, adopted, row.outcome ?? null, now],
    );
    const c: import("../agent/types").CoachingCommitment = {
      id,
      suggestion: row.suggestion,
      reason: row.reason ?? null,
      dateSuggested: row.dateSuggested,
      dateDue: row.dateDue ?? null,
      adopted: !!row.adopted,
      outcome: row.outcome ?? null,
      createdAt: now,
    };
    set({ coachingCommitments: [c, ...get().coachingCommitments] });
    void syncCoachingCommitmentToServer(c);
    return id;
  },

  setCoachingCommitmentAdopted: async (id, adopted, outcome = null) => {
    const prev = get().coachingCommitments.find((x) => x.id === id);
    const db = await getDatabase();
    await db.runAsync(
      "UPDATE coaching_commitments SET adopted = ?, outcome = ? WHERE id = ?",
      [adopted ? 1 : 0, outcome ?? null, id],
    );
    set({
      coachingCommitments: get().coachingCommitments.map((c) =>
        c.id === id ? { ...c, adopted, outcome: outcome ?? c.outcome } : c,
      ),
    });
    if (prev) {
      void syncCoachingCommitmentToServer({
        ...prev,
        adopted,
        outcome: outcome ?? prev.outcome,
      });
    }
  },
}));
