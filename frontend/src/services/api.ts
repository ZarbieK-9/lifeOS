// REST API client — talks to Envoy gRPC-JSON transcoder proxy
// All requests are standard HTTP/JSON; Envoy translates to gRPC backend.
// Tokens stored in expo-secure-store (encrypted).

import * as SecureStore from 'expo-secure-store';
import { kv } from '../db/mmkv';

// ── Config ──────────────────────────────────────────
// Backend URL from .env (build-time), with MMKV override for runtime changes

const BACKEND_URL_KEY = 'backend_url';
const ENV_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

function getBackendUrl(): string | null {
  return kv.getString(BACKEND_URL_KEY) || ENV_BACKEND_URL || null;
}
const USER_ID_KEY = 'user_id';
const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

// ── Token helpers ───────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

async function setTokens(access: string, refresh: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh);
}

async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

// ── Core fetch wrapper ──────────────────────────────

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResult<T>> {
  const base = getBackendUrl();
  if (!base) return { ok: false, error: 'No backend URL configured' };

  let token = await getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  try {
    const fetchTag = `[apiFetch] ${options.method || 'GET'} ${path}`;
    console.time(fetchTag);
    let res = await fetch(`${base}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers as Record<string, string>) },
    });
    console.timeEnd(fetchTag);

    // Auto-refresh on 401
    if (res.status === 401 && token) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        headers.Authorization = `Bearer ${refreshed}`;
        res = await fetch(`${base}${path}`, {
          ...options,
          headers: { ...headers, ...(options.headers as Record<string, string>) },
        });
      } else {
        await clearTokens();
        return { ok: false, error: 'Session expired', status: 401 };
      }
    }

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: body, status: res.status };
    }

    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : ({} as T);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const base = getBackendUrl();
  const refresh = await getRefreshToken();
  if (!base || !refresh) return null;
  try {
    const res = await fetch(`${base}/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    await setTokens(data.access_token, data.refresh_token);
    return data.access_token;
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────

export const api = {
  // Config
  getBaseUrl: () => getBackendUrl(),
  setBaseUrl: (url: string) => kv.set(BACKEND_URL_KEY, url.replace(/\/+$/, '')),
  isConfigured: () => !!getBackendUrl(),

  // Auth
  login: async (username: string, password: string) => {
    const result = await apiFetch<{
      access_token: string;
      refresh_token: string;
      user_id: string;
    }>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (result.ok) {
      await setTokens(result.data.access_token, result.data.refresh_token);
      kv.set(USER_ID_KEY, result.data.user_id);
    }
    return result;
  },

  register: async (
    username: string,
    password: string,
    displayName: string,
  ) => {
    return apiFetch<{ user_id: string }>('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password,
        display_name: displayName,
      }),
    });
  },

  logout: async () => {
    await clearTokens();
    kv.delete(USER_ID_KEY);
  },

  isAuthenticated: async () => !!(await getAccessToken()),

  // Health
  health: () => apiFetch<{ status: string; db: string; mqtt: string }>('/v1/health'),

  // Sync batch (for drainQueue)
  syncBatch: (
    events: Array<{
      id: string;
      type: string;
      payload: string;
      created_at: string;
    }>,
  ) =>
    apiFetch<{ processed: number; failed: string[] }>('/v1/sync/batch', {
      method: 'POST',
      body: JSON.stringify({ events }),
    }),

  // Tasks
  getTasks: () =>
    apiFetch<{ tasks: Array<Record<string, unknown>> }>('/v1/tasks'),

  createTask: (task: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>('/v1/tasks', {
      method: 'POST',
      body: JSON.stringify(task),
    }),

  updateTask: (taskId: string, fields: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/v1/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ task_id: taskId, ...fields }),
    }),

  deleteTask: (taskId: string) =>
    apiFetch<Record<string, unknown>>(`/v1/tasks/${taskId}`, {
      method: 'DELETE',
    }),

  // Hydration
  getHydration: () =>
    apiFetch<{ logs: Array<Record<string, unknown>> }>('/v1/hydration'),

  logHydration: (entry: {
    log_id: string;
    amount_ml: number;
    timestamp: string;
  }) =>
    apiFetch<Record<string, unknown>>('/v1/hydration', {
      method: 'POST',
      body: JSON.stringify(entry),
    }),

  // AI
  submitAiCommand: (id: string, input: string, contextJson?: string) =>
    apiFetch<{
      id: string;
      output: string;
      status: string;
      intents?: Array<{ tool: string; params_json: string }>;
    }>(
      '/v1/ai/command',
      {
        method: 'POST',
        body: JSON.stringify({ id, input, context_json: contextJson }),
      },
    ),

  // AI agentic turn (multi-turn loop)
  agentTurn: (params: {
    session_id?: string;
    input?: string;
    context_json?: string;
    tool_results?: Array<{
      tool: string;
      success: boolean;
      message: string;
      data_json?: string;
    }>;
  }) =>
    apiFetch<{
      session_id: string;
      output: string;
      intents: Array<{ tool: string; params_json: string }>;
      done: boolean;
      turn: number;
      status: string;
    }>('/v1/ai/agent-turn', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  getAiHistory: () =>
    apiFetch<{ commands: Array<Record<string, unknown>> }>('/v1/ai/history'),

  // Voice transcription
  transcribeAudio: async (audioUri: string): Promise<ApiResult<{ text: string }>> => {
    const base = getBackendUrl();
    if (!base) return { ok: false, error: 'No backend URL configured' };

    const token = await getAccessToken();
    const formData = new FormData();
    formData.append('audio', {
      uri: audioUri,
      type: 'audio/m4a',
      name: 'recording.m4a',
    } as any);

    try {
      const res = await fetch(`${base}/v1/ai/transcribe`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });

      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: body };
      }

      const data = await res.json();
      return { ok: true, data: data as { text: string } };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  // Partner
  getPartnerSnippets: () =>
    apiFetch<{ snippets: Array<Record<string, unknown>> }>(
      '/v1/partner/snippets',
    ),

  sendPartnerSnippet: (snippet: {
    snippet_id: string;
    partner_id: string;
    content: string;
    timestamp: string;
  }) =>
    apiFetch<Record<string, unknown>>('/v1/partner/snippets', {
      method: 'POST',
      body: JSON.stringify(snippet),
    }),

  // Sleep
  getSleepSessions: () =>
    apiFetch<{ sessions: Array<Record<string, unknown>> }>('/v1/sleep'),

  recordSleep: (session: {
    session_id: string;
    sleep_start: string;
    sleep_end: string;
    duration_minutes: number;
  }) =>
    apiFetch<Record<string, unknown>>('/v1/sleep', {
      method: 'POST',
      body: JSON.stringify(session),
    }),

  // Automation rules
  getAutomationRules: () =>
    apiFetch<{ rules: Array<Record<string, unknown>> }>('/v1/automation/rules'),

  createAutomationRule: (rule: {
    name: string;
    description: string;
    rule_type: string;
    schedule?: string;
    condition?: string;
    actions: string;
    enabled: boolean;
  }) =>
    apiFetch<Record<string, unknown>>('/v1/automation/rules', {
      method: 'POST',
      body: JSON.stringify(rule),
    }),

  updateAutomationRule: (id: string, fields: Record<string, unknown>) =>
    apiFetch<Record<string, unknown>>(`/v1/automation/rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ id, ...fields }),
    }),

  deleteAutomationRule: (id: string) =>
    apiFetch<Record<string, unknown>>(`/v1/automation/rules/${id}`, {
      method: 'DELETE',
    }),

  // API Keys (for external integrations)
  createApiKey: (name: string) =>
    apiFetch<{ key_id: string; api_key: string; name: string; created_at: string }>(
      '/v1/apikeys',
      {
        method: 'POST',
        body: JSON.stringify({ name }),
      },
    ),

  listApiKeys: () =>
    apiFetch<{
      keys: Array<{
        key_id: string;
        name: string;
        created_at: string;
        last_used: string;
        key_prefix: string;
      }>;
    }>('/v1/apikeys'),

  revokeApiKey: (keyId: string) =>
    apiFetch<Record<string, unknown>>(`/v1/apikeys/${keyId}`, {
      method: 'DELETE',
    }),
};
