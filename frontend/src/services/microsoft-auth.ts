// Microsoft identity (Entra ID) — OAuth2 + PKCE for Microsoft Graph (calendar read).
// Configure EXPO_PUBLIC_MICROSOFT_CLIENT_ID in Azure Portal as a mobile/public client.

import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { kv } from '../db/mmkv';

WebBrowser.maybeCompleteAuthSession();

const CLIENT_ID =
  process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID?.trim() ||
  kv.getString('microsoft_client_id') ||
  '';

const DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
};

const SCOPES = ['Calendars.Read', 'offline_access', 'openid', 'profile', 'email'];

const ACCESS_KEY = 'microsoft_access_token';
const REFRESH_KEY = 'microsoft_refresh_token';
const EXPIRY_KEY = 'microsoft_token_expiry';

async function fetchGraphEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { mail?: string; userPrincipalName?: string };
    return j.mail || j.userPrincipalName || null;
  } catch {
    return null;
  }
}

async function storeTokens(access: string, refresh: string | undefined, expiresInSec: number): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  if (refresh) await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  const exp = Date.now() + expiresInSec * 1000;
  await SecureStore.setItemAsync(EXPIRY_KEY, String(exp));
}

export const microsoftAuth = {
  isConnected: (): boolean => kv.getBool('microsoft_connected'),

  getAccessToken: async (): Promise<string | null> => {
    const exp = await SecureStore.getItemAsync(EXPIRY_KEY);
    const access = await SecureStore.getItemAsync(ACCESS_KEY);
    if (access && exp && Date.now() < parseInt(exp, 10) - 60_000) return access;
    return refreshAccessToken();
  },

  signIn: async (): Promise<{ success: boolean; email?: string | null }> => {
    if (!CLIENT_ID) {
      throw new Error(
        'Microsoft Client ID not set. Add EXPO_PUBLIC_MICROSOFT_CLIENT_ID (Azure Portal → App registration → mobile/public client).',
      );
    }
    const redirectUri = AuthSession.makeRedirectUri({ scheme: 'lifeos' });
    const request = new AuthSession.AuthRequest({
      clientId: CLIENT_ID,
      redirectUri,
      scopes: SCOPES,
      usePKCE: true,
      responseType: AuthSession.ResponseType.Code,
    });
    const result = await request.promptAsync(DISCOVERY);
    if (result.type !== 'success' || !result.params.code || !request.codeVerifier) {
      return { success: false };
    }
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code: result.params.code,
      redirect_uri: redirectUri,
      code_verifier: request.codeVerifier,
    });
    const tokenRes = await fetch(DISCOVERY.tokenEndpoint!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.warn('[microsoft-auth] token exchange failed', tokenRes.status, t);
      return { success: false };
    }
    const tok = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    await storeTokens(tok.access_token, tok.refresh_token, tok.expires_in ?? 3600);
    let email = await fetchGraphEmail(tok.access_token);
    if (email) kv.set('microsoft_email', email);
    kv.set('microsoft_connected', true);
    return { success: true, email };
  },

  disconnect: async (): Promise<void> => {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
    await SecureStore.deleteItemAsync(EXPIRY_KEY);
    kv.set('microsoft_connected', false);
    kv.delete('microsoft_email');
  },
};

async function refreshAccessToken(): Promise<string | null> {
  const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
  if (!refresh || !CLIENT_ID) return null;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refresh,
    scope: SCOPES.join(' '),
  });
  const res = await fetch(DISCOVERY.tokenEndpoint!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) return null;
  const tok = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  await storeTokens(tok.access_token, tok.refresh_token ?? refresh, tok.expires_in ?? 3600);
  return tok.access_token;
}
