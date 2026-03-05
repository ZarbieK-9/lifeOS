// MQTT client — mqtt.js via WebSocket to Mosquitto port 9001
// Handles real-time partner snippets and presence status.

import mqtt from 'mqtt';
import dayjs from 'dayjs';
import { kv } from '../db/mmkv';
import { getDatabase, uid } from '../db/database';
import { useStore } from '../store/useStore';

let client: mqtt.MqttClient | null = null;

// ── Topic structure ─────────────────────────────────
// partner/snippet/{user_id}   — incoming snippets FOR this user (subscribe)
// partner/status/{user_id}    — presence status (publish + subscribe)

interface MqttMessage {
  type: 'snippet' | 'status';
  from_user_id: string;
  content: string;
  timestamp: string;
}

function deriveWsUrl(backendUrl: string): string {
  // http://192.168.1.100:8080 → ws://192.168.1.100:9001/mqtt
  try {
    const url = new URL(backendUrl);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.hostname}:9001/mqtt`;
  } catch {
    return 'ws://localhost:9001/mqtt';
  }
}

const ENV_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';
const ENV_MQTT_USERNAME = process.env.EXPO_PUBLIC_MQTT_USERNAME ?? 'lifeos_user1';
const ENV_MQTT_PASSWORD = process.env.EXPO_PUBLIC_MQTT_PASSWORD ?? 'lifeos_user1_pass';

export const mqttService = {
  isConnected: () => client?.connected ?? false,

  connect: (mqttUsername?: string, mqttPassword?: string) => {
    if (client?.connected) return;

    const baseUrl = kv.getString('backend_url') || ENV_BACKEND_URL;
    if (!baseUrl) return;

    const userId = kv.getString('user_id');
    if (!userId) return;

    const wsUrl = deriveWsUrl(baseUrl);
    const username = mqttUsername || ENV_MQTT_USERNAME;
    const password = mqttPassword || ENV_MQTT_PASSWORD;

    try {
      client = mqtt.connect(wsUrl, {
        clientId: `lifeos_${userId}_${Date.now()}`,
        username,
        password,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
      });

      client.on('connect', () => {
        console.log('[MQTT] Connected');
        kv.set('mqtt_connected', true);

        // Subscribe to messages directed at this user
        client?.subscribe(`partner/snippet/${userId}`, { qos: 1 });
        client?.subscribe('partner/status/+', { qos: 0 });

        // Publish online status (retained)
        const statusMsg: MqttMessage = {
          type: 'status',
          from_user_id: userId,
          content: 'online',
          timestamp: dayjs().toISOString(),
        };
        client?.publish(
          `partner/status/${userId}`,
          JSON.stringify(statusMsg),
          { qos: 0, retain: true },
        );
      });

      client.on('message', async (topic: string, payload: Buffer) => {
        try {
          const msg: MqttMessage = JSON.parse(payload.toString());

          if (topic.startsWith('partner/snippet/')) {
            // Incoming snippet — persist to SQLite + update store
            const db = await getDatabase();
            const snippetId = uid();
            await db.runAsync(
              'INSERT OR IGNORE INTO partner_snippets (snippet_id, partner_id, content, timestamp, synced) VALUES (?,?,?,?,1)',
              [snippetId, msg.from_user_id, msg.content, msg.timestamp],
            );
            useStore.getState().loadPartnerSnippets();
          } else if (topic.startsWith('partner/status/')) {
            // Partner status update
            const partnerId = topic.split('/').pop() || '';
            if (partnerId !== userId) {
              useStore.getState().setPartnerStatus(
                partnerId,
                msg.content === 'online',
                msg.timestamp,
              );
            }
          }
        } catch (e) {
          console.error('[MQTT] Parse error:', e);
        }
      });

      client.on('error', (err) => {
        console.error('[MQTT] Error:', err);
        kv.set('mqtt_connected', false);
      });

      client.on('offline', () => {
        console.log('[MQTT] Offline');
        kv.set('mqtt_connected', false);
      });

      client.on('reconnect', () => {
        console.log('[MQTT] Reconnecting...');
      });
    } catch (e) {
      console.error('[MQTT] Connect failed:', e);
    }
  },

  disconnect: () => {
    const userId = kv.getString('user_id');
    if (client && userId) {
      // Publish offline status with retain
      const statusMsg: MqttMessage = {
        type: 'status',
        from_user_id: userId,
        content: 'offline',
        timestamp: dayjs().toISOString(),
      };
      client.publish(
        `partner/status/${userId}`,
        JSON.stringify(statusMsg),
        { qos: 0, retain: true },
      );
      client.end();
      client = null;
      kv.set('mqtt_connected', false);
    }
  },

  publishSnippet: (partnerId: string, content: string): boolean => {
    const userId = kv.getString('user_id');
    if (!client?.connected || !userId) return false;

    const msg: MqttMessage = {
      type: 'snippet',
      from_user_id: userId,
      content,
      timestamp: dayjs().toISOString(),
    };

    client.publish(
      `partner/snippet/${partnerId}`,
      JSON.stringify(msg),
      { qos: 1 },
    );
    return true;
  },
};
