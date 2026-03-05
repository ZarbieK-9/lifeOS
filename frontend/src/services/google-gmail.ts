// Gmail v1 REST API client + rule-based triage engine
// Direct mobile → Google API. No LLM needed for categorization.

import { googleAuth } from './google-auth';

const BASE = 'https://www.googleapis.com/gmail/v1/users/me';

// ── Types ──

export interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  labelIds: string[];
  internalDate: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    mimeType: string;
    body?: { data?: string; size: number };
    parts?: Array<{
      mimeType: string;
      body?: { data?: string; size: number };
    }>;
  };
}

export interface GmailMessageMeta {
  id: string;
  threadId: string;
  snippet: string;
  from: string;
  subject: string;
  date: string;
  isUnread: boolean;
  isStarred: boolean;
  labelIds: string[];
}

export type EmailCategory = 'important' | 'action_needed' | 'fyi' | 'newsletter';

type GmResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ── Authenticated fetch ──

async function gmailFetch<T>(path: string, options: RequestInit = {}): Promise<GmResult<T>> {
  const token = await googleAuth.getAccessToken();
  if (!token) return { ok: false, error: 'Not authenticated with Google' };

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers as Record<string, string>),
      },
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `${res.status}: ${body}` };
    }

    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : ({} as T);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Public API ──

export const googleGmail = {
  /** List message IDs matching a query */
  listMessages: async (
    query = 'is:unread in:inbox',
    maxResults = 20,
  ): Promise<GmResult<string[]>> => {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(maxResults),
    });
    const result = await gmailFetch<{ messages?: Array<{ id: string }> }>(
      `/messages?${params}`,
    );
    if (result.ok) {
      return { ok: true, data: (result.data.messages ?? []).map(m => m.id) };
    }
    return result as GmResult<string[]>;
  },

  /** Get a single message with metadata or full body */
  getMessage: async (
    messageId: string,
    format: 'metadata' | 'full' = 'metadata',
  ): Promise<GmResult<GmailMessage>> => {
    const params = new URLSearchParams({ format });
    if (format === 'metadata') {
      params.set('metadataHeaders', 'From');
      params.append('metadataHeaders', 'Subject');
      params.append('metadataHeaders', 'Date');
    }
    return gmailFetch<GmailMessage>(`/messages/${messageId}?${params}`);
  },

  /** Batch-fetch message metadata for a list of IDs */
  getMessagesMeta: async (
    messageIds: string[],
  ): Promise<GmResult<GmailMessageMeta[]>> => {
    const results: GmailMessageMeta[] = [];
    for (let i = 0; i < messageIds.length; i += 10) {
      const batch = messageIds.slice(i, i + 10);
      const promises = batch.map(id => googleGmail.getMessage(id, 'metadata'));
      const responses = await Promise.all(promises);
      for (const res of responses) {
        if (res.ok) {
          results.push(parseMessageMeta(res.data));
        }
      }
    }
    return { ok: true, data: results };
  },

  /** Mark a message as read */
  markAsRead: async (messageId: string): Promise<GmResult<void>> => {
    return gmailFetch<void>(`/messages/${messageId}/modify`, {
      method: 'POST',
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    });
  },

  /** Toggle star on a message */
  toggleStar: async (
    messageId: string,
    starred: boolean,
  ): Promise<GmResult<void>> => {
    return gmailFetch<void>(`/messages/${messageId}/modify`, {
      method: 'POST',
      body: JSON.stringify(
        starred
          ? { addLabelIds: ['STARRED'] }
          : { removeLabelIds: ['STARRED'] },
      ),
    });
  },

  /** Get full message body text */
  getMessageBody: async (messageId: string): Promise<GmResult<string>> => {
    const result = await googleGmail.getMessage(messageId, 'full');
    if (!result.ok) return result as GmResult<string>;
    return { ok: true, data: extractBodyText(result.data) };
  },
};

// ── Triage engine (rule-based, no LLM) ──

const NEWSLETTER_PATTERNS = [
  'unsubscribe', 'view in browser', 'email preferences',
  'noreply', 'no-reply', 'newsletter', 'digest', 'weekly update',
  'marketing', 'promotions',
];

const ACTION_PATTERNS = [
  'action required', 'action needed', 'please review',
  'please respond', 'rsvp', 'deadline', 'due by', 'due date',
  'urgent', 'asap', 'by eod', 'by end of day',
  'can you', 'could you', 'would you', 'please send',
  'need your', 'waiting on you', 'follow up', 'follow-up',
  'approve', 'approval', 'sign', 'signature required',
  'invitation', 'meeting request',
];

/** Categorize an email based on headers, labels, and body content */
export function categorizeEmail(meta: GmailMessageMeta, bodyText?: string): EmailCategory {
  const from = meta.from.toLowerCase();
  const subject = meta.subject.toLowerCase();
  const body = (bodyText ?? '').toLowerCase();
  const text = subject + ' ' + body;

  // Newsletter detection
  if (NEWSLETTER_PATTERNS.some(p => body.includes(p) || from.includes(p))) {
    if (!ACTION_PATTERNS.some(p => text.includes(p))) return 'newsletter';
  }

  // Important: has IMPORTANT label or is starred
  if (meta.labelIds.includes('IMPORTANT') || meta.isStarred) {
    return 'important';
  }

  // Action needed
  if (ACTION_PATTERNS.some(p => text.includes(p))) {
    return 'action_needed';
  }

  return 'fyi';
}

/** Extract potential task/action items from email body */
export function extractTasksFromEmail(subject: string, bodyText: string): string[] {
  const tasks: string[] = [];
  const lines = bodyText.split(/\n/).map(l => l.trim()).filter(Boolean);

  const taskPatterns = [
    /(?:please|kindly|can you|could you|would you)\s+(.{10,80})/i,
    /(?:action required|todo|to.do|action item)[:\s]+(.{10,80})/i,
    /(?:deadline|due(?:\s+by)?)[:\s]+(.{10,80})/i,
    /^\s*[-*]\s+(.{10,80})/,
    /(?:need to|needs to|must)\s+(.{10,80})/i,
  ];

  for (const line of lines.slice(0, 50)) {
    for (const pattern of taskPatterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        const task = match[1].replace(/[.!?,;:]+$/, '').trim();
        if (task.length > 5 && task.length < 120) {
          tasks.push(task);
        }
      }
    }
  }

  return [...new Set(tasks)].slice(0, 5);
}

// ── Helpers ──

function parseMessageMeta(msg: GmailMessage): GmailMessageMeta {
  const headers = msg.payload.headers;
  const getHeader = (name: string) =>
    headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

  return {
    id: msg.id,
    threadId: msg.threadId,
    snippet: msg.snippet,
    from: getHeader('From'),
    subject: getHeader('Subject'),
    date: getHeader('Date')
      ? new Date(getHeader('Date')).toISOString()
      : new Date(parseInt(msg.internalDate)).toISOString(),
    isUnread: msg.labelIds.includes('UNREAD'),
    isStarred: msg.labelIds.includes('STARRED'),
    labelIds: msg.labelIds,
  };
}

function extractBodyText(msg: GmailMessage): string {
  if (msg.payload.parts) {
    const textPart = msg.payload.parts.find(p => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      return base64UrlDecode(textPart.body.data);
    }
  }
  if (msg.payload.body?.data) {
    return base64UrlDecode(msg.payload.body.data);
  }
  return msg.snippet;
}

function base64UrlDecode(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return atob(base64);
  } catch {
    return data;
  }
}
