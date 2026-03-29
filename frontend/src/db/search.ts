// FTS5 RAG — Full-Text Search for smart context retrieval
// Instead of dumping all recent items into the LLM context,
// we search for items relevant to the user's input.
//
// Tables indexed: tasks, notes, ai_memory, expenses
// expo-sqlite supports FTS5 via SQLite's built-in module.

import { getDatabase } from './database';

// ── Schema: create FTS5 virtual tables ──────────────────

export async function createSearchIndex(): Promise<void> {
  const db = await getDatabase();

  // FTS5 virtual table — unified search across content types
  // content="" means contentless — we manually keep it in sync
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
}

// ── Index sync helpers ──────────────────────────────────

/** Index a single item. Safe to call on insert or update (deletes old entry first). */
export async function indexItem(
  contentType: 'task' | 'note' | 'memory' | 'expense' | 'habit' | 'goal',
  contentId: string,
  title: string,
  body: string,
  category: string,
  dateVal: string,
): Promise<void> {
  const db = await getDatabase();
  // Remove old entry first (upsert pattern for FTS5)
  await db.runAsync(
    `DELETE FROM search_index WHERE content_id = ?`,
    [contentId],
  );
  await db.runAsync(
    `INSERT INTO search_index (content_type, content_id, title, body, category, date_val) VALUES (?, ?, ?, ?, ?, ?)`,
    [contentType, contentId, title, body || '', category || '', dateVal || ''],
  );
}

/** Remove an item from the search index. */
export async function removeFromIndex(contentId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `DELETE FROM search_index WHERE content_id = ?`,
    [contentId],
  );
}

// ── Bulk rebuild (run once on init, or after schema changes) ──

export async function rebuildSearchIndex(): Promise<void> {
  const db = await getDatabase();

  // Clear existing index
  await db.execAsync(`DELETE FROM search_index`);

  // Index tasks
  const tasks = await db.getAllAsync<{
    task_id: string; title: string; notes: string; priority: string; status: string; due_date: string;
  }>(`SELECT task_id, title, notes, priority, status, due_date FROM tasks WHERE status != 'completed'`);

  for (const t of tasks) {
    await db.runAsync(
      `INSERT INTO search_index (content_type, content_id, title, body, category, date_val) VALUES (?, ?, ?, ?, ?, ?)`,
      ['task', t.task_id, t.title, t.notes || '', t.priority, t.due_date || ''],
    );
  }

  // Index notes
  const notes = await db.getAllAsync<{
    id: string; title: string; body: string; category: string; updated_at: string;
  }>(`SELECT id, title, body, category, updated_at FROM notes ORDER BY updated_at DESC LIMIT 100`);

  for (const n of notes) {
    await db.runAsync(
      `INSERT INTO search_index (content_type, content_id, title, body, category, date_val) VALUES (?, ?, ?, ?, ?, ?)`,
      ['note', n.id, n.title, n.body || '', n.category, n.updated_at],
    );
  }

  // Index AI memories
  const memories = await db.getAllAsync<{
    id: string; fact: string; category: string; created_at: string;
  }>(`SELECT id, fact, category, created_at FROM ai_memory`);

  for (const m of memories) {
    await db.runAsync(
      `INSERT INTO search_index (content_type, content_id, title, body, category, date_val) VALUES (?, ?, ?, ?, ?, ?)`,
      ['memory', m.id, m.fact, '', m.category, m.created_at],
    );
  }

  // Index expenses (recent 90 days)
  const expenses = await db.getAllAsync<{
    id: string; description: string; category: string; amount: number; date: string;
  }>(`SELECT id, description, category, amount, date FROM expenses WHERE date >= date('now', '-90 days')`);

  for (const e of expenses) {
    await db.runAsync(
      `INSERT INTO search_index (content_type, content_id, title, body, category, date_val) VALUES (?, ?, ?, ?, ?, ?)`,
      ['expense', e.id, e.description || '', `${e.amount}`, e.category, e.date],
    );
  }

  console.log(`[SearchIndex] rebuilt: ${tasks.length} tasks, ${notes.length} notes, ${memories.length} memories, ${expenses.length} expenses`);
}

// ── Search ──────────────────────────────────────────────

export interface SearchResult {
  contentType: 'task' | 'note' | 'memory' | 'expense' | 'habit';
  contentId: string;
  title: string;
  body: string;
  category: string;
  dateVal: string;
  rank: number;
}

/**
 * Search the FTS5 index for items relevant to a query.
 * Returns ranked results — most relevant first.
 *
 * @param query  User input or extracted keywords
 * @param limit  Max results (default 10)
 * @param types  Optional filter by content type
 */
export async function searchRelevantContext(
  query: string,
  limit = 10,
  types?: string[],
): Promise<SearchResult[]> {
  const db = await getDatabase();

  // Clean query for FTS5 — remove special chars, keep words
  const cleanQuery = query
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1)
    .slice(0, 8) // limit to 8 keywords
    .join(' OR '); // OR matching for broader recall

  if (!cleanQuery) return [];

  let sql = `
    SELECT content_type, content_id, title, body, category, date_val,
           rank
    FROM search_index
    WHERE search_index MATCH ?
  `;
  const params: any[] = [cleanQuery];

  if (types && types.length > 0) {
    sql += ` AND content_type IN (${types.map(() => '?').join(',')})`;
    params.push(...types);
  }

  sql += ` ORDER BY rank LIMIT ?`;
  params.push(limit);

  try {
    const rows = await db.getAllAsync<{
      content_type: string; content_id: string; title: string;
      body: string; category: string; date_val: string; rank: number;
    }>(sql, params);

    return rows.map(r => ({
      contentType: r.content_type as SearchResult['contentType'],
      contentId: r.content_id,
      title: r.title,
      body: r.body,
      category: r.category,
      dateVal: r.date_val,
      rank: r.rank,
    }));
  } catch (e) {
    // FTS5 can throw on malformed queries — return empty gracefully
    console.warn('[SearchIndex] search failed:', e);
    return [];
  }
}

// ── Synonym map for broader FTS5 recall ──────────────────
const SYNONYMS: Record<string, string[]> = {
  food: ['grocery', 'groceries', 'meal', 'eating', 'restaurant', 'lunch', 'dinner', 'breakfast'],
  car: ['transport', 'transportation', 'vehicle', 'gas', 'fuel', 'uber', 'lyft'],
  exercise: ['workout', 'gym', 'run', 'running', 'fitness', 'training'],
  work: ['office', 'job', 'meeting', 'project'],
  money: ['expense', 'payment', 'cost', 'bill', 'budget', 'spend', 'spending'],
  doctor: ['medical', 'health', 'appointment', 'clinic', 'hospital'],
  shop: ['shopping', 'store', 'purchase', 'buy', 'bought'],
  travel: ['trip', 'flight', 'hotel', 'vacation'],
};

// Build reverse map for O(1) lookup
const _reverseMap = new Map<string, string[]>();
for (const [key, syns] of Object.entries(SYNONYMS)) {
  if (!_reverseMap.has(key)) _reverseMap.set(key, []);
  _reverseMap.get(key)!.push(...syns);
  for (const s of syns) {
    if (!_reverseMap.has(s)) _reverseMap.set(s, []);
    _reverseMap.get(s)!.push(key, ...syns.filter(x => x !== s));
  }
}

function expandWithSynonyms(keywords: string[]): string[] {
  const expanded = new Set(keywords);
  for (const kw of keywords) {
    const syns = _reverseMap.get(kw);
    if (syns) {
      for (const s of syns) expanded.add(s);
    }
  }
  return [...expanded].slice(0, 15);
}

/**
 * Extract keywords from user input for FTS5 search.
 * Strips stopwords, expands with synonyms for broader recall.
 */
export function extractKeywords(input: string): string {
  const stopwords = new Set([
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they',
    'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'can', 'may', 'might', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'that', 'this',
    'what', 'which', 'who', 'how', 'when', 'where', 'why', 'all', 'each',
    'not', 'no', 'so', 'if', 'then', 'than', 'too', 'very', 'just', 'also',
    'please', 'hey', 'hi', 'hello', 'thanks', 'okay', 'ok', 'yeah', 'yes',
  ]);

  const keywords = input
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopwords.has(w))
    .slice(0, 10);

  return expandWithSynonyms(keywords).join(' ');
}
