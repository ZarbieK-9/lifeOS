import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { getDatabase } from '../db/database';
import { kv } from '../db/mmkv';

const BACKUP_TABLES = [
  'tasks',
  'hydration_logs',
  'sleep_sessions',
  'partner_snippets',
  'habits',
  'habit_logs',
  'mood_logs',
  'notes',
  'inbox_items',
  'time_blocks',
  'expenses',
  'budgets',
  'user_profile',
  'weight_log',
  'goals',
  'plans',
  'behavior_patterns',
  'watcher_queue',
  'coaching_commitments',
  'routines',
  'automation_rules',
  'ai_memory',
  'daily_streaks',
  'reminders',
];

const BACKUP_MMKV_KEYS = [
  'hydration_goal',
  'hydration_reminder_enabled',
  'auto_morning_enabled',
  'auto_night_enabled',
  'proactive_checkin_interval_min',
  'proactive_quiet_after_hour',
  'proactive_quiet_before_hour',
  'allowed_notif_packages',
  'current_chat_id',
];

export async function exportBackup(): Promise<void> {
  const db = await getDatabase();
  const backup: Record<string, unknown> = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: {} as Record<string, unknown[]>,
    mmkv: {} as Record<string, unknown>,
  };

  const tables = backup.tables as Record<string, unknown[]>;
  for (const table of BACKUP_TABLES) {
    try {
      const rows = await db.getAllAsync(`SELECT * FROM ${table}`);
      tables[table] = rows;
    } catch {
      tables[table] = [];
    }
  }

  const mmkvData = backup.mmkv as Record<string, unknown>;
  for (const key of BACKUP_MMKV_KEYS) {
    const str = kv.getString(key);
    if (str !== undefined) {
      mmkvData[key] = str;
      continue;
    }
    const num = kv.getNumber(key);
    if (num !== undefined) {
      mmkvData[key] = num;
    }
  }

  const filename = `lifeos-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const path = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(backup));

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: 'application/json' });
  }
}

export async function importBackup(): Promise<{ ok: boolean; message: string }> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.[0]) {
    return { ok: false, message: 'Cancelled' };
  }

  const uri = result.assets[0].uri;
  const content = await FileSystem.readAsStringAsync(uri);

  let backup: Record<string, unknown>;
  try {
    backup = JSON.parse(content);
  } catch {
    return { ok: false, message: 'Invalid JSON file' };
  }

  if (!backup.version || !backup.tables) {
    return { ok: false, message: 'Not a valid LifeOS backup file' };
  }

  const db = await getDatabase();
  const tables = backup.tables as Record<string, Record<string, unknown>[]>;
  let restoredCount = 0;

  for (const table of BACKUP_TABLES) {
    const rows = tables[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    try {
      await db.runAsync(`DELETE FROM ${table}`);

      for (const row of rows) {
        const cols = Object.keys(row);
        const placeholders = cols.map(() => '?').join(',');
        const values = cols.map((c) => {
          const v = row[c];
          return v === null || v === undefined ? null : v;
        });
        await db.runAsync(
          `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`,
          values as (string | number | null)[],
        );
      }
      restoredCount++;
    } catch {
      // Table might not exist in current schema — skip
    }
  }

  // Restore MMKV keys
  if (backup.mmkv && typeof backup.mmkv === 'object') {
    const mmkvData = backup.mmkv as Record<string, unknown>;
    for (const [key, val] of Object.entries(mmkvData)) {
      if (typeof val === 'string') kv.set(key, val);
      else if (typeof val === 'number') kv.set(key, val);
      else if (typeof val === 'boolean') kv.set(key, val ? '1' : '0');
    }
  }

  // Reload store
  const { useStore } = await import('../store/useStore');
  useStore.setState({ ready: false });
  await useStore.getState().init();

  return { ok: true, message: `Restored ${restoredCount} tables` };
}
