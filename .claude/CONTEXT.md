# CONTEXT.md

# Project: LifeOS

Mobile-first, self-hosted, offline-first personal automation + partner companion app.
Built with React Native + Expo (SDK 54), expo-router file-based navigation.

---

# Project Structure

```
app/                          # expo-router file-based routes
  (tabs)/
    _layout.tsx               # 5-tab bottom nav: Home, Tasks, AI, Partner, Settings
    index.tsx                 # → src/screens/HomeScreen.tsx
    tasks.tsx                 # → src/screens/TasksScreen.tsx
    ai.tsx                    # → src/screens/AiScreen.tsx
    partner.tsx               # → src/screens/PartnerScreen.tsx
    settings.tsx              # → src/screens/SettingsScreen.tsx
    explore.tsx               # hidden (original boilerplate)
  _layout.tsx                 # Root stack: (tabs) + modal
  modal.tsx

src/
  db/
    database.ts               # SQLite init, table creation, uid()
    mmkv.ts                   # MMKV cache (createMMKV v4 API), kv helpers
  store/
    useStore.ts               # Zustand store: tasks, hydration, focus, sleep, queue, AI, partner, auth
  services/
    api.ts                    # REST client → Envoy → gRPC backend (JWT auth, auto-refresh)
    mqtt.ts                   # mqtt.js WebSocket client for real-time partner communication
    auth.ts                   # Auth lifecycle (login → JWT → MQTT connect)
  hooks/
    useHaptics.ts             # light/medium/success/warning/error haptic patterns
    useNetwork.ts             # NetInfo listener, auto-drain queue + MQTT reconnect
    useSleep.ts               # Accelerometer-based sleep detection → auto focus mode
    useFocusTimer.ts          # 1-min interval countdown, notification on complete
  screens/
    HomeScreen.tsx             # Dashboard: sleep, hydration, focus, quick actions, queue badge
    TasksScreen.tsx            # CRUD tasks, filter tabs, priority badges, add modal
    AiScreen.tsx               # Command input, gRPC backend + local fallback, response cards
    PartnerScreen.tsx          # Partner list from MQTT status, snippet history, real-time send
    SettingsScreen.tsx         # Backend URL, auth, queue management, sync, encryption, backup

backend/                       # Python gRPC backend (self-hosted)
  proto/lifeos.proto           # Protobuf service definitions with google.api.http annotations
  app/
    server.py                  # Async gRPC server with JWT auth
    config.py, auth.py, db.py  # Configuration, JWT, SQLAlchemy async
    models.py                  # PostgreSQL models (mirrors mobile SQLite schema + users)
    services/                  # 8 gRPC service implementations
  Dockerfile, requirements.txt

docker-compose.yml             # PostgreSQL + Mosquitto + gRPC Backend + Envoy proxy
mosquitto/config/              # Eclipse Mosquitto MQTT broker config
envoy/envoy.yaml               # gRPC-JSON transcoder (HTTP/JSON ↔ gRPC)

components/                   # Expo boilerplate shared components
constants/theme.ts            # App color tokens (light/dark)
hooks/                        # Expo boilerplate hooks (useColorScheme, useThemeColor)
```

---

# Installed Packages (from package.json)

## Expo SDK
expo, expo-av, expo-constants, expo-crypto, expo-device, expo-font, expo-haptics,
expo-image, expo-linking, expo-location, expo-notifications, expo-router,
expo-secure-store, expo-sensors, expo-splash-screen, expo-sqlite, expo-status-bar,
expo-symbols, expo-system-ui, expo-web-browser

## Community
@expo/vector-icons, @react-native-community/netinfo, @react-navigation/bottom-tabs,
@react-navigation/elements, @react-navigation/native, dayjs, react-native-gesture-handler,
react-native-mmkv, react-native-reanimated, react-native-safe-area-context,
react-native-screens, react-native-web, react-native-worklets, zustand

## Backend Communication
mqtt (mqtt.js — MQTT WebSocket client for partner sync)

## Not yet installed (install when needed)
drizzle-orm, react-native-svg, json-rules-engine, cron-parser

---

# SQLite Tables (in src/db/database.ts)

- `tasks` — task_id, title, due_date, priority, notes, status, created_at, updated_at
- `hydration_logs` — log_id, amount_ml, timestamp, synced
- `partner_snippets` — snippet_id, partner_id, content, timestamp, synced
- `sleep_sessions` — session_id, sleep_start, sleep_end, duration_minutes
- `event_queue` — id, type, payload, created_at, retry_count, status
- `ai_commands` — id, input, output, status, created_at

---

# Key Patterns

- **Screens** live in `src/screens/`, re-exported via `app/(tabs)/*.tsx` one-liners
- **State** is in one Zustand store (`useStore`), backed by MMKV for sync reads + SQLite for persistence
- **MMKV v4**: use `createMMKV({ id: 'lifeos' })` — NOT `new MMKV()`
- **Offline queue**: `useStore.enqueueEvent()` → `event_queue` table → auto-drained by `useNetwork` hook
- **Haptics**: import `useHaptics()` from `src/hooks/useHaptics.ts`
- **Colors**: inline `light`/`dark` const objects per screen (not a global theme provider)
- **Timestamps**: always `dayjs().toISOString()` (UTC ISO8601)
