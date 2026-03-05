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

  // Migrations — add columns to existing tables (run before any index on new columns)
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
