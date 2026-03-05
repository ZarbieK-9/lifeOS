# TASKS.md

# What's Done

- [x] Expo project initialized (SDK 54, expo-router, TypeScript)
- [x] All core packages installed (see package.json)
- [x] SQLite database layer with 6 tables (`src/db/database.ts`)
- [x] MMKV fast cache layer (`src/db/mmkv.ts`)
- [x] Zustand store with full CRUD for tasks, hydration, focus, sleep, queue, AI, partner (`src/store/useStore.ts`)
- [x] Haptic feedback hook (`src/hooks/useHaptics.ts`)
- [x] Network monitoring + auto queue drain (`src/hooks/useNetwork.ts`)
- [x] Sleep detection via accelerometer (`src/hooks/useSleep.ts`)
- [x] Focus mode countdown timer (`src/hooks/useFocusTimer.ts`)
- [x] Home/Dashboard screen — sleep, hydration, focus cards + quick actions + queue badge
- [x] Tasks screen — CRUD, filter tabs, priority, add modal
- [x] AI Assistant screen — command input, local parsing, response cards with status badges
- [x] Partner screen — partner list, snippet history, send input (MQTT stub)
- [x] Settings screen — queue management, sync, encryption, backup
- [x] 5-tab navigation wired up
- [x] TypeScript passes with zero errors

---

# What's Next

## High Priority
- [ ] Build with `npx expo start` and fix any runtime errors on device/emulator
- [ ] Add `expo-dev-client` for native module testing (MMKV, SQLite, sensors need native)
- [x] Wire up real MQTT client (mqtt.js) for partner sync (`src/services/mqtt.ts`)
- [ ] Add local audio assets (`assets/sounds/`) and wire `expo-av` feedback
- [ ] Add `react-native-svg` charts for hydration/sleep trends on Home screen
- [ ] Implement `json-rules-engine` for deterministic rule evaluation

## Medium Priority
- [ ] Add `drizzle-orm` typed query layer on top of raw SQLite
- [ ] Task recurring schedules with `cron-parser`
- [x] gRPC backend with Envoy JSON transcoder (`backend/`, `docker-compose.yml`)
- [x] Encryption at rest toggle in Settings (AES-256 placeholder)
- [x] JWT token storage in `expo-secure-store` (`src/services/api.ts`)
- [x] Partner snippet MQTT publish/subscribe with QoS1 (`src/services/mqtt.ts`)

## Low Priority
- [x] Docker Compose for self-hosted backend (Mosquitto + Python gRPC + PostgreSQL + Envoy)
- [ ] Traefik TLS reverse proxy config (commented out in docker-compose.yml)
- [ ] EAS build configuration for production APK/IPA
- [ ] Unit tests for store actions
- [ ] Integration tests for offline queue cycle
