// SQLite database setup — CONTEXT.md: "expo-sqlite (offline database)"
// Table schemas from EXAMPLES.md §4
// All AI actions go through sandboxed tools, never direct DB access (SYSTEM.md §1)

import * as SQLite from 'expo-sqlite';

let _db: SQLite.SQLiteDatabase | null = null;
let _opening: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return Promise.resolve(_db);
  // Singleton promise — all concurrent callers share one open call
  if (!_opening) {
    _opening = (async () => {
      const db = await SQLite.openDatabaseAsync('lifeos.db');
      await db.execAsync('PRAGMA journal_mode = WAL;');
      await createTables(db);
      _db = db;
      return db;
    })().catch((e) => {
      _opening = null; // allow retry on failure
      throw e;
    });
  }
  return _opening;
}

async function createTables(db: SQLite.SQLiteDatabase) {
  // Tasks — EXAMPLES.md §4.1
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      due_date TEXT,
      priority TEXT CHECK(priority IN ('low','medium','high')) DEFAULT 'medium',
      notes TEXT,
      status TEXT CHECK(status IN ('pending','completed','overdue')) DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Hydration logs — EXAMPLES.md §4.2
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS hydration_logs (
      log_id TEXT PRIMARY KEY,
      amount_ml INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      synced INTEGER DEFAULT 0
    );
  `);

  // Partner snippets — EXAMPLES.md §4.3
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS partner_snippets (
      snippet_id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL,
      content TEXT,
      timestamp TEXT,
      synced INTEGER DEFAULT 0
    );
  `);

  // Sleep sessions
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS sleep_sessions (
      session_id TEXT PRIMARY KEY,
      sleep_start TEXT NOT NULL,
      sleep_end TEXT,
      duration_minutes INTEGER DEFAULT 0
    );
  `);

  // Offline event queue — SYSTEM.md §5
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS event_queue (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      retry_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending'
    );
  `);

  // Chat sessions — one per conversation (ChatGPT-style)
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
  `);

  // AI command history (chat_id added by migration below for existing DBs)
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ai_commands (
      id TEXT PRIMARY KEY,
      input TEXT NOT NULL,
      output TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // User-defined routines — PicoClaw agent
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_phrases TEXT NOT NULL,
      steps TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Automation rules — schedule or condition-based
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS automation_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      rule_type TEXT NOT NULL,
      schedule TEXT,
      condition TEXT,
      actions TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_triggered TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Reminders — push notification scheduling
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS reminders (
      reminder_id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      trigger_at TEXT NOT NULL,
      fired INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Conversation memory — facts extracted from AI conversations
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS ai_memory (
      id TEXT PRIMARY KEY,
      fact TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      source_cmd_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    );
  `);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_ai_memory_created ON ai_memory(created_at);
  `);

  // Daily streak tracking
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS daily_streaks (
      date TEXT PRIMARY KEY,
      hydration_met INTEGER DEFAULT 0,
      tasks_completed INTEGER DEFAULT 0,
      sleep_logged INTEGER DEFAULT 0,
      habits_done INTEGER DEFAULT 0,
      score INTEGER DEFAULT 0
    );
  `);

  // Custom habits (user-created trackable habits)
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '✓',
      target_per_day INTEGER DEFAULT 1,
      unit TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Habit log entries
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS habit_logs (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
      value INTEGER DEFAULT 1,
      logged_at TEXT NOT NULL
    );
  `);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs(logged_at);
  `);

  // Mood & Energy check-ins
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS mood_logs (
      id TEXT PRIMARY KEY,
      mood INTEGER NOT NULL CHECK(mood BETWEEN 1 AND 5),
      energy INTEGER NOT NULL CHECK(energy BETWEEN 1 AND 5),
      note TEXT,
      logged_at TEXT NOT NULL
    );
  `);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_mood_logs_date ON mood_logs(logged_at);
  `);

  // Notes / Quick Journal
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      category TEXT DEFAULT 'note',
      pinned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
  `);

  // Quick Capture / Inbox
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS inbox_items (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      triaged INTEGER DEFAULT 0,
      triage_result TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Time Blocks — Morning Planner
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS time_blocks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      source TEXT DEFAULT 'manual',
      task_id TEXT,
      color TEXT DEFAULT '#5a8f86',
      date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_time_blocks_date ON time_blocks(date);
  `);

  // Expense Tracker
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      category TEXT DEFAULT 'other',
      description TEXT,
      date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
  `);

  // Budgets
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      monthly_limit REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // FTS5 search index — full-text search for RAG context retrieval
  await db.execAsync(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      content_type,
      content_id,
      title,
      body,
      category,
      date_val,
      tokenize='porter unicode61'
    );
  `);

  // App settings (morning/sleep summary, proactive AI) — persisted so they survive restarts
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY,
      auto_morning_enabled INTEGER NOT NULL DEFAULT 1,
      auto_night_enabled INTEGER NOT NULL DEFAULT 1,
      proactive_checkin_interval_min INTEGER NOT NULL DEFAULT 90,
      proactive_quiet_after_hour INTEGER NOT NULL DEFAULT 21,
      proactive_quiet_before_hour INTEGER NOT NULL DEFAULT 7,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Google OAuth connection state (connected flag + email; tokens stay in SecureStore)
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS google_oauth_state (
      id TEXT PRIMARY KEY,
      connected INTEGER NOT NULL DEFAULT 0,
      email TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Me profile — weight, height, goals, BMR/TDEE
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id TEXT PRIMARY KEY,
      weight_kg REAL,
      height_cm REAL,
      birth_date TEXT,
      gender TEXT,
      activity_level TEXT,
      target_weight_kg REAL,
      target_date TEXT,
      goal_type TEXT,
      day_outline TEXT,
      activity_prefs TEXT,
      typical_wake_time TEXT,
      leave_home_time TEXT,
      work_start_time TEXT,
      typical_bedtime TEXT,
      day_coach_enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS weight_log (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      weight_kg REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_weight_log_date ON weight_log(date);
  `).catch(() => {});

  // ── Agentic system tables ──────────────────────────

  // Goals — what the user wants to achieve (long-term)
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      domain TEXT NOT NULL,
      target_value REAL,
      current_value REAL DEFAULT 0,
      unit TEXT,
      deadline TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','paused','abandoned')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);`);

  // Plans — concrete action plans generated by agents to achieve goals
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      goal_id TEXT REFERENCES goals(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      steps TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','failed')),
      scheduled_for TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_plans_goal ON plans(goal_id);`);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);`);

  // Agent actions — tracks what agents did and outcomes
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS agent_actions (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      action_type TEXT NOT NULL,
      input TEXT,
      output TEXT,
      goal_id TEXT,
      plan_id TEXT,
      success INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_agent_actions_agent ON agent_actions(agent);`);

  // Behavior patterns — learned from user data (statistical, not LLM)
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS behavior_patterns (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      pattern_type TEXT NOT NULL,
      description TEXT NOT NULL,
      data TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      sample_count INTEGER DEFAULT 0,
      last_updated TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_patterns_domain ON behavior_patterns(domain);`);

  // Watcher queue — low-priority notifications queued for in-app display
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS watcher_queue (
      id TEXT PRIMARY KEY,
      domain TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      priority TEXT DEFAULT 'low' CHECK(priority IN ('high','low')),
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migration: add acted_on tracking to watcher queue for engagement learning
  try { await db.execAsync('ALTER TABLE watcher_queue ADD COLUMN acted_on INTEGER DEFAULT 0'); } catch { /* already exists */ }
  try { await db.execAsync('ALTER TABLE watcher_queue ADD COLUMN rule_id TEXT'); } catch { /* already exists */ }
  try { await db.execAsync('ALTER TABLE watcher_queue ADD COLUMN suggested_action TEXT'); } catch { /* already exists */ }

  // Coaching commitments — evening coach follow-ups
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS coaching_commitments (
      id TEXT PRIMARY KEY,
      suggestion TEXT NOT NULL,
      reason TEXT,
      date_suggested TEXT NOT NULL,
      date_due TEXT,
      adopted INTEGER DEFAULT 0,
      outcome TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrations — add columns to existing tables (run before any index on new columns)
  try { await db.execAsync('ALTER TABLE user_profile ADD COLUMN day_outline TEXT'); } catch { /* already exists */ }
  try { await db.execAsync('ALTER TABLE user_profile ADD COLUMN activity_prefs TEXT'); } catch { /* already exists */ }
  try { await db.execAsync('ALTER TABLE user_profile ADD COLUMN typical_wake_time TEXT'); } catch { /* already exists */ }
  try { await db.execAsync('ALTER TABLE user_profile ADD COLUMN leave_home_time TEXT'); } catch { /* already exists */ }
  try { await db.execAsync('ALTER TABLE user_profile ADD COLUMN work_start_time TEXT'); } catch { /* already exists */ }
  try { await db.execAsync('ALTER TABLE user_profile ADD COLUMN typical_bedtime TEXT'); } catch { /* already exists */ }
  try { await db.execAsync('ALTER TABLE user_profile ADD COLUMN day_coach_enabled INTEGER DEFAULT 1'); } catch { /* already exists */ }
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN recurrence TEXT'); } catch { /* already exists */ }
  try { await db.execAsync("ALTER TABLE ai_commands ADD COLUMN source TEXT DEFAULT 'user'"); } catch { /* already exists */ }
  try { await db.execAsync('ALTER TABLE ai_commands ADD COLUMN chat_id TEXT'); } catch { /* already exists */ }
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_ai_commands_chat ON ai_commands(chat_id);
  `).catch(() => { /* index may exist */ });

  // Backfill: migrate existing ai_commands without chat_id into a default chat
  try {
    const legacy = await db.getAllAsync<{ id: string }>('SELECT id FROM ai_commands WHERE chat_id IS NULL OR chat_id = "" LIMIT 1');
    if (legacy.length > 0) {
      const defaultChatId = 'default-' + Date.now();
      const now = new Date().toISOString();
      await db.runAsync('INSERT OR IGNORE INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [defaultChatId, 'Previous chats', now, now]);
      await db.runAsync('UPDATE ai_commands SET chat_id = ? WHERE chat_id IS NULL OR chat_id = ""', [defaultChatId]);
    }
  } catch { /* ignore */ }

  // Calendar events cache — Google Calendar integration
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      event_id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      description TEXT,
      location TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      all_day INTEGER DEFAULT 0,
      status TEXT DEFAULT 'confirmed',
      html_link TEXT,
      google_calendar_id TEXT DEFAULT 'primary',
      synced_at TEXT NOT NULL,
      raw_json TEXT
    );
  `);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_time);
  `);

  // Email metadata cache — Gmail integration
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS email_cache (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      from_address TEXT NOT NULL,
      subject TEXT NOT NULL,
      snippet TEXT,
      date TEXT NOT NULL,
      is_unread INTEGER DEFAULT 1,
      is_starred INTEGER DEFAULT 0,
      label_ids TEXT,
      body_text TEXT,
      synced_at TEXT NOT NULL
    );
  `);

  // Email triage results
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS email_categories (
      message_id TEXT PRIMARY KEY REFERENCES email_cache(message_id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN ('important','action_needed','fyi','newsletter')),
      extracted_tasks TEXT,
      categorized_at TEXT NOT NULL
    );
  `);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_email_categories_category ON email_categories(category);
  `);
}

export function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const GOOGLE_OAUTH_STATE_ID = "default";

/** Persist Google OAuth connection state to DB (connected flag + email; tokens stay in SecureStore). */
export async function saveGoogleOAuthState(
  connected: boolean,
  email: string | null,
): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO google_oauth_state (id, connected, email, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET connected = excluded.connected, email = excluded.email, updated_at = excluded.updated_at`,
    [GOOGLE_OAUTH_STATE_ID, connected ? 1 : 0, email ?? null, now],
  );
}

/** Load Google OAuth connection state from DB. */
export async function loadGoogleOAuthState(): Promise<{
  connected: boolean;
  email: string | null;
} | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    connected: number;
    email: string | null;
  }>("SELECT connected, email FROM google_oauth_state WHERE id = ?", [
    GOOGLE_OAUTH_STATE_ID,
  ]);
  if (!row) return null;
  return {
    connected: row.connected !== 0,
    email: row.email ?? null,
  };
}

const APP_SETTINGS_ID = "default";

export interface AppSettingsRow {
  auto_morning_enabled: number;
  auto_night_enabled: number;
  proactive_checkin_interval_min: number;
  proactive_quiet_after_hour: number;
  proactive_quiet_before_hour: number;
}

/** Load app settings from DB. */
export async function loadAppSettings(): Promise<AppSettingsRow | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<AppSettingsRow>(
    "SELECT auto_morning_enabled, auto_night_enabled, proactive_checkin_interval_min, proactive_quiet_after_hour, proactive_quiet_before_hour FROM app_settings WHERE id = ?",
    [APP_SETTINGS_ID],
  );
  return row ?? null;
}

/** Save app settings to DB. */
export async function saveAppSettings(settings: {
  auto_morning_enabled?: boolean;
  auto_night_enabled?: boolean;
  proactive_checkin_interval_min?: number;
  proactive_quiet_after_hour?: number;
  proactive_quiet_before_hour?: number;
}): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const row = await db.getFirstAsync<AppSettingsRow>(
    "SELECT * FROM app_settings WHERE id = ?",
    [APP_SETTINGS_ID],
  );
  const am = settings.auto_morning_enabled ?? (row?.auto_morning_enabled !== 0);
  const an = settings.auto_night_enabled ?? (row?.auto_night_enabled !== 0);
  const checkin = settings.proactive_checkin_interval_min ?? row?.proactive_checkin_interval_min ?? 90;
  const afterH = settings.proactive_quiet_after_hour ?? row?.proactive_quiet_after_hour ?? 21;
  const beforeH = settings.proactive_quiet_before_hour ?? row?.proactive_quiet_before_hour ?? 7;
  await db.runAsync(
    `INSERT INTO app_settings (id, auto_morning_enabled, auto_night_enabled, proactive_checkin_interval_min, proactive_quiet_after_hour, proactive_quiet_before_hour, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       auto_morning_enabled = excluded.auto_morning_enabled,
       auto_night_enabled = excluded.auto_night_enabled,
       proactive_checkin_interval_min = excluded.proactive_checkin_interval_min,
       proactive_quiet_after_hour = excluded.proactive_quiet_after_hour,
       proactive_quiet_before_hour = excluded.proactive_quiet_before_hour,
       updated_at = excluded.updated_at`,
    [APP_SETTINGS_ID, am ? 1 : 0, an ? 1 : 0, checkin, afterH, beforeH, now],
  );
}
