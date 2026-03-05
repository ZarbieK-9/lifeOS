# EXAMPLES.md

# How to add a new feature

## 1. Add state + actions to store (`src/store/useStore.ts`)

```ts
// In the interface
newData: SomeType[];
doNewThing: (input: string) => Promise<void>;

// In create()
newData: [],
doNewThing: async (input) => {
  const db = await getDatabase();
  const id = uid();
  await db.runAsync('INSERT INTO some_table (id, value, created_at) VALUES (?,?,?)',
    [id, input, dayjs().toISOString()]
  );
  set({ newData: [{ id, value: input }, ...get().newData] });

  if (!get().isOnline) {
    await get().enqueueEvent('new_thing', { id, input });
  }
},
```

## 2. Create screen (`src/screens/NewScreen.tsx`)

```tsx
import React from 'react';
import { View, Text, StyleSheet, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { useHaptics } from '../hooks/useHaptics';

export default function NewScreen() {
  const theme = useColorScheme();
  const c = theme === 'dark' ? dark : light;
  const haptic = useHaptics();
  const data = useStore(s => s.newData);

  return (
    <SafeAreaView style={[ss.fill, { backgroundColor: c.bg }]}>
      {/* content */}
    </SafeAreaView>
  );
}

const light = { bg: '#fff', surface: '#f5f7fa', border: '#e2e8f0', text: '#11181c', sub: '#687076', primary: '#0a7ea4' };
const dark  = { bg: '#151718', surface: '#1e2022', border: '#2d3338', text: '#ecedee', sub: '#9ba1a6', primary: '#38bdf8' };
const ss = StyleSheet.create({ fill: { flex: 1 } });
```

## 3. Add route file (`app/(tabs)/newscreen.tsx`)

```tsx
export { default } from '@/src/screens/NewScreen';
```

## 4. Register tab in `app/(tabs)/_layout.tsx`

```tsx
<Tabs.Screen
  name="newscreen"
  options={{
    title: 'New',
    tabBarIcon: ({ color }) => <IconSymbol size={28} name="some.icon" color={color} />,
  }}
/>
```

Add the SF Symbol → Material Icon mapping in `components/ui/icon-symbol.tsx`.

---

# AI Tool Registry (store methods that map to gRPC tools)

| Tool | Store method | Inputs | When offline |
|------|-------------|--------|-------------|
| `add_task` | `addTask()` | title, priority?, dueDate?, notes? | Works locally |
| `log_hydration` | `logHydration()` | amount_ml | Queues sync event |
| `set_focus_mode` | `toggleFocus()` | durationMin? | Works locally |
| `send_partner_snippet` | stub | partner_id, content | Queues MQTT event |

---

# MMKV Cache Keys (src/db/mmkv.ts)

| Key | Type | Usage |
|-----|------|-------|
| `sleep` | JSON (SleepState) | Restore sleep state on app launch |
| `hydration_today` | number | Fast dashboard read |
| `focus_enabled` | boolean | Instant focus state |
| `focus_started` | string | Focus session start ISO |
| `focus_duration` | number | Focus session total min |
| `focus_remaining` | number | Focus countdown min |
| `queue_count` | number | Badge count without DB read |
| `encryption_enabled` | boolean | Settings toggle |
| `notifications_enabled` | boolean | Settings toggle |

---

# Offline Queue Flow (already implemented)

```
User action (e.g. logHydration)
  → Write to SQLite (source of truth)
  → Update MMKV cache (fast reads)
  → Update Zustand state (re-render)
  → if (!isOnline) → enqueueEvent() → event_queue table
  → useNetwork hook detects reconnect → drainQueue() → process + delete events
```
