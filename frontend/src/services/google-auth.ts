// Google OAuth — expo-auth-session with PKCE
// Tokens in expo-secure-store, connection status in MMKV
// Scopes: Calendar (read/write) + Gmail (modify)

import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { kv } from '../db/mmkv';
import { saveGoogleOAuthState } from '../db/database';

WebBrowser.maybeCompleteAuthSession();

// ── Config ──
// From .env (EXPO_PUBLIC_GOOGLE_CLIENT_ID), with MMKV runtime override
const GOOGLE_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ||
  kv.getString('google_client_id') ||
  '';

/** If set, use this as redirect URI (e.g. https://your-ngrok.ngrok-free.app/oauth/google/callback). Google requires a valid TLD; auth.expo.io is often rejected. */
const CUSTOM_REDIRECT_URI =
  process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI?.trim() || '';

/** Use a Desktop app OAuth client (PKCE only, no client_secret). Set to "true" when using a Desktop client in Google Cloud to avoid "client_secret is missing" errors. */
const USE_DESKTOP_CLIENT =
  process.env.EXPO_PUBLIC_GOOGLE_USE_DESKTOP_CLIENT === 'true';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.modify',
  'openid',
  'email',
];

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

// ── SecureStore / MMKV keys ──
const GOOGLE_ACCESS_TOKEN_KEY = 'google_access_token';
const GOOGLE_REFRESH_TOKEN_KEY = 'google_refresh_token';
const GOOGLE_TOKEN_EXPIRY_KEY = 'google_token_expiry';
const GOOGLE_OAUTH_PENDING_KEY = 'google_oauth_pending';
const GOOGLE_OAUTH_PENDING_TTL_MS = 10 * 60 * 1000; // 10 min (time to complete sign-in and tap "Visit Site" if needed)

// ── Service ──

/** Backend URL from env or MMKV (same URL the app uses for API calls). */
function getBackendUrl(): string {
  return (kv.getString('backend_url') || process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');
}

/** Redirect URI for Google OAuth. When using Desktop client (PKCE only), use app redirect. Else backend URL + /oauth/google/callback or custom. Must match Google Console exactly (no trailing slash). */
export function getGoogleRedirectUri(): string {
  if (USE_DESKTOP_CLIENT) return AuthSession.makeRedirectUri();
  if (CUSTOM_REDIRECT_URI) return CUSTOM_REDIRECT_URI.trim().replace(/\/+$/, '');
  const base = getBackendUrl();
  if (base && (base.startsWith('https://') || base.startsWith('http://')))
    return `${base.replace(/\/+$/, '')}/oauth/google/callback`;
  return AuthSession.makeRedirectUri();
}

export const googleAuth = {
  /** Check if connected (sync, from MMKV) */
  isConnected: (): boolean => kv.getBool('google_connected'),

  /**
   * Restore connection state from stored tokens (e.g. on app start).
   * If we have a refresh_token or valid access_token, set google_connected and email so the user stays logged in.
   */
  restoreConnection: async (): Promise<{ connected: boolean; email?: string | null }> => {
    const token = await googleAuth.getAccessToken();
    if (!token) {
      // Preserve signed-in UX when we still have stored credentials.
      // This avoids forcing re-auth on app restart during transient network issues.
      const hasSession = await hasStoredGoogleSession();
      if (!hasSession) {
        kv.set('google_connected', false);
        kv.delete('google_email');
        try {
          await saveGoogleOAuthState(false, null);
        } catch (e) {
          console.warn('[google-auth] Failed to persist disconnect to DB:', e);
        }
        return { connected: false };
      }
      kv.set('google_connected', true);
      const cachedEmail = kv.getString('google_email') ?? null;
      return { connected: true, email: cachedEmail };
    }

    kv.set('google_connected', true);
    let email = kv.getString('google_email') ?? null;
    if (!email) {
      email = await fetchGoogleEmail(token);
      if (email) kv.set('google_email', email);
    }
    try {
      await saveGoogleOAuthState(true, email);
    } catch (e) {
      console.warn('[google-auth] Failed to persist to DB:', e);
    }
    return { connected: true, email };
  },

  /** Get current access token with auto-refresh */
  getAccessToken: async (): Promise<string | null> => {
    const expiry = await SecureStore.getItemAsync(GOOGLE_TOKEN_EXPIRY_KEY);
    const accessToken = await SecureStore.getItemAsync(GOOGLE_ACCESS_TOKEN_KEY);

    if (accessToken && expiry && Date.now() < parseInt(expiry) - 60_000) {
      return accessToken;
    }

    // Attempt refresh
    return refreshToken();
  },

  /** Initiate Google OAuth sign-in flow */
  signIn: async (): Promise<{ success: boolean; email?: string }> => {
    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === 'your-client-id.apps.googleusercontent.com') {
      throw new Error(
        'Google Client ID not set. Add EXPO_PUBLIC_GOOGLE_CLIENT_ID to your .env file. See .env.example or GOOGLE_SIGNIN_SETUP.md.'
      );
    }
    const redirectUri = getGoogleRedirectUri();

    const request = new AuthSession.AuthRequest({
      clientId: GOOGLE_CLIENT_ID,
      redirectUri,
      scopes: SCOPES,
      usePKCE: true,
      responseType: AuthSession.ResponseType.Code,
      extraParams: {
        access_type: 'offline',
        prompt: 'select_account',
        include_granted_scopes: 'true',
      },
    });

    const redirectGoesToBackend = redirectUri.startsWith('http');
    if (redirectGoesToBackend) {
      await request.makeAuthUrlAsync(discovery);
      const authUrl = request.url;
      if (!authUrl) return { success: false };
      kv.set(GOOGLE_OAUTH_PENDING_KEY, JSON.stringify({
        code_verifier: request.codeVerifier,
        redirect_uri: redirectUri,
        ts: Date.now(),
      }));
      // Open in system browser so the lifeos:// redirect opens this app; in-app browser often gets stuck.
      const opened = await Linking.openURL(authUrl);
      if (!opened) {
        await WebBrowser.openBrowserAsync(authUrl);
      }
      return { success: false };
    }

    const result = await request.promptAsync(discovery);

    if (result.type !== 'success' || !result.params.code) {
      return { success: false };
    }

    return exchangeAndStore(request.codeVerifier!, result.params.code, redirectUri);
  },

  completeSignInFromDeepLink: async (url: string): Promise<{ success: boolean; email?: string } | null> => {
    if (!url.startsWith('lifeos://oauth')) return null;
    const parsed = Linking.parse(url);
    const code = parsed.queryParams?.code as string | undefined;
    const error = parsed.queryParams?.error as string | undefined;
    if (error) return { success: false };
    if (!code) return null;
    const raw = kv.getString(GOOGLE_OAUTH_PENDING_KEY);
    if (!raw) return null;
    let pending: { code_verifier?: string; redirect_uri: string; ts: number };
    try {
      pending = JSON.parse(raw);
    } catch {
      return null;
    }
    if (Date.now() - pending.ts > GOOGLE_OAUTH_PENDING_TTL_MS) {
      kv.delete(GOOGLE_OAUTH_PENDING_KEY);
      return null;
    }
    kv.delete(GOOGLE_OAUTH_PENDING_KEY);
    if (!pending.code_verifier || !pending.redirect_uri) return null;
    return exchangeAndStore(pending.code_verifier, code, pending.redirect_uri);
  },

  /** Disconnect Google account */
  disconnect: async (): Promise<void> => {
    const token = await SecureStore.getItemAsync(GOOGLE_ACCESS_TOKEN_KEY);
    if (token) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
          method: 'POST',
        });
      } catch { /* best effort */ }
    }
    await SecureStore.deleteItemAsync(GOOGLE_ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(GOOGLE_REFRESH_TOKEN_KEY);
    await SecureStore.deleteItemAsync(GOOGLE_TOKEN_EXPIRY_KEY);
    kv.set('google_connected', false);
    kv.delete('google_email');
    try {
      await saveGoogleOAuthState(false, null);
    } catch (e) {
      console.warn('[google-auth] Failed to persist disconnect to DB:', e);
    }
  },
};

// ── Private helpers ──

async function exchangeAndStore(
  codeVerifier: string,
  code: string,
  redirectUri: string,
): Promise<{ success: boolean; email?: string }> {
  let accessToken: string;
  let refreshToken: string | undefined;
  let expiresIn: number;

  if (redirectUri.startsWith('http')) {
    const base = getBackendUrl();
    if (!base) throw new Error('Backend URL not set');
    const res = await fetch(`${base}/oauth/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || `Exchange failed: ${res.status}`);
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    expiresIn = Number(data.expires_in) || 3600;
  } else {
    const tokenResponse = await AuthSession.exchangeCodeAsync(
      {
        clientId: GOOGLE_CLIENT_ID,
        code,
        redirectUri,
        extraParams: { code_verifier: codeVerifier },
      },
      discovery,
    );
    accessToken = tokenResponse.accessToken;
    refreshToken = tokenResponse.refreshToken;
    expiresIn = tokenResponse.expiresIn ?? 3600;
  }

  await SecureStore.setItemAsync(GOOGLE_ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) {
    await SecureStore.setItemAsync(GOOGLE_REFRESH_TOKEN_KEY, refreshToken);
  }
  const expiresAt = Date.now() + expiresIn * 1000;
  await SecureStore.setItemAsync(GOOGLE_TOKEN_EXPIRY_KEY, String(expiresAt));
  const email = await fetchGoogleEmail(accessToken);
  kv.set('google_connected', true);
  if (email) kv.set('google_email', email);
  try {
    await saveGoogleOAuthState(true, email ?? null);
  } catch (e) {
    console.warn('[google-auth] Failed to persist to DB:', e);
  }
  return { success: true, email: email ?? undefined };
}

async function refreshToken(): Promise<string | null> {
  const refresh = await SecureStore.getItemAsync(GOOGLE_REFRESH_TOKEN_KEY);
  if (!refresh) return null;

  try {
    const tokenResponse = await AuthSession.refreshAsync(
      { clientId: GOOGLE_CLIENT_ID, refreshToken: refresh },
      discovery,
    );
    await SecureStore.setItemAsync(GOOGLE_ACCESS_TOKEN_KEY, tokenResponse.accessToken);
    const expiresAt = Date.now() + (tokenResponse.expiresIn ?? 3600) * 1000;
    await SecureStore.setItemAsync(GOOGLE_TOKEN_EXPIRY_KEY, String(expiresAt));
    if (tokenResponse.refreshToken) {
      await SecureStore.setItemAsync(GOOGLE_REFRESH_TOKEN_KEY, tokenResponse.refreshToken);
    }
    return tokenResponse.accessToken;
  } catch {
    return null;
  }
}

async function hasStoredGoogleSession(): Promise<boolean> {
  const access = await SecureStore.getItemAsync(GOOGLE_ACCESS_TOKEN_KEY);
  const refresh = await SecureStore.getItemAsync(GOOGLE_REFRESH_TOKEN_KEY);
  return Boolean(access || refresh);
}

async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    return data.email ?? null;
  } catch {
    return null;
  }
}
