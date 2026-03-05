// MMKV fast cache — CONTEXT.md: "react-native-mmkv (ultra-fast local storage backup)"
// Synchronous reads for instant UI on launch. SQLite is source of truth.
// Falls back to in-memory Map when native modules unavailable (Expo Go).

interface KVStorage {
  getString(key: string): string | undefined;
  getNumber(key: string): number | undefined;
  getBoolean(key: string): boolean | undefined;
  set(key: string, value: string | number | boolean): void;
  remove(key: string): void;
}

// In-memory fallback — data lost on restart, but SQLite restores it via init()
class MemoryStorage implements KVStorage {
  private map = new Map<string, string | number | boolean>();
  getString(key: string) { const v = this.map.get(key); return typeof v === 'string' ? v : undefined; }
  getNumber(key: string) { const v = this.map.get(key); return typeof v === 'number' ? v : undefined; }
  getBoolean(key: string) { const v = this.map.get(key); return typeof v === 'boolean' ? v : undefined; }
  set(key: string, value: string | number | boolean) { this.map.set(key, value); }
  remove(key: string) { this.map.delete(key); }
}

let storage: KVStorage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'lifeos' });
} catch {
  // Expected in Expo Go; in-memory fallback is used. Use a dev build for persistent MMKV.
  if (__DEV__) {
    console.debug('[MMKV] Using in-memory fallback (Expo Go)');
  }
  storage = new MemoryStorage();
}

export { storage };

// Typed helpers
export const kv = {
  getString: (key: string) => storage.getString(key) ?? null,
  getNumber: (key: string) => storage.getNumber(key) ?? 0,
  getBool: (key: string) => storage.getBoolean(key) ?? false,
  set: (key: string, value: string | number | boolean) => storage.set(key, value),
  setJSON: <T>(key: string, value: T) => storage.set(key, JSON.stringify(value)),
  getJSON: <T>(key: string): T | null => {
    const raw = storage.getString(key);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  },
  delete: (key: string) => storage.remove(key),
};
