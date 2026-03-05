// Auth lifecycle — combines api + mqtt for login/logout/restore flow.
// On login: store tokens → connect MQTT.
// On logout: disconnect MQTT → clear tokens.
// On app start: restore tokens → reconnect MQTT if valid.

import { api } from './api';
import { mqttService } from './mqtt';
import { kv } from '../db/mmkv';

export interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  username: string | null;
}

export const auth = {
  getState: (): AuthState => ({
    isAuthenticated: !!kv.getString('user_id'),
    userId: kv.getString('user_id') ?? null,
    username: kv.getString('username') ?? null,
  }),

  login: async (username: string, password: string) => {
    const result = await api.login(username, password);
    if (result.ok) {
      kv.set('username', username);
      mqttService.connect();
    }
    return result;
  },

  register: async (
    username: string,
    password: string,
    displayName: string,
  ) => {
    return api.register(username, password, displayName);
  },

  logout: async () => {
    mqttService.disconnect();
    await api.logout();
    kv.delete('username');
    kv.delete('user_id');
    kv.set('mqtt_connected', false);
  },

  // Called on app startup from store.init()
  restore: async (): Promise<boolean> => {
    if (!api.isConfigured()) return false;

    const isAuth = await api.isAuthenticated();
    if (isAuth) {
      // Verify the token is still valid
      const health = await api.health();
      if (health.ok) {
        mqttService.connect();
        return true;
      }
    }
    return false;
  },
};
