# UI_UX.md

# Navigation (implemented)

Bottom tabs — 5 screens:
1. **Home** — Dashboard with sleep/hydration/focus cards + quick actions
2. **Tasks** — List with filters (all/pending/completed/overdue) + add modal
3. **AI** — Chat-style command input + response cards with status badges
4. **Partner** — Partner list + snippet history + send input
5. **Settings** — Queue management, sync, encryption, backup

---

# Screen Layouts (implemented)

## Home (`src/screens/HomeScreen.tsx`)
- Offline banner (yellow, shows queue count) when `isOnline === false`
- Greeting header (time-based: Good Morning/Afternoon/Evening/Night)
- Sleep card: status (Sleeping/Awake), duration, wake time
- Hydration card: progress bar, ml/target, quick-add buttons (250/500/750ml)
- Focus card: toggle switch, countdown, progress bar, start time
- Quick actions row: Log Water, Add Task, Focus, Sync
- Queue indicator: count badge + retry button

## Tasks (`src/screens/TasksScreen.tsx`)
- Header with "+ New" button
- Filter tabs: All, Pending, Completed, Overdue
- Task rows: checkbox, title, priority badge, due date, delete button
- Add modal: title input, notes input, priority selector, save/cancel

## AI (`src/screens/AiScreen.tsx`)
- Header with offline badge
- Command history (FlatList of cards)
- Each card: user input (U avatar), AI output (A avatar), status badge + timestamp
- Input bar with send button
- Local parsing: "log 500ml water", "add task buy groceries", "enable focus mode"

## Partner (`src/screens/PartnerScreen.tsx`)
- Partner row: online dot, name, last seen, connection badge
- Snippets list: content, timestamp, sync status (green/orange/red dot)
- Send input bar

## Settings (`src/screens/SettingsScreen.tsx`)
- Network status bar (green online / yellow offline)
- Queue section: pending count, event list, Sync Now / Clear buttons
- Notifications toggle
- Encryption toggle
- Backup / Restore buttons
- App version

---

# Design Patterns

- **Colors:** Inline `light`/`dark` objects per screen. No global theme context beyond the navigation ThemeProvider.
- **Dark mode:** `useColorScheme()` from React Native, ternary selects palette.
- **Touch targets:** Minimum 44pt on all interactive elements.
- **Cards:** `borderRadius: 12-16`, `borderWidth: 1`, `padding: 14-16`.
- **Feedback:**
  - Button press → `haptic.light()`
  - Success action (hydration logged, task added) → `haptic.success()`
  - Toggle (focus mode) → `haptic.medium()`
  - Warning (offline queue) → `haptic.warning()`
  - Error → `haptic.error()`
- **Offline indicators:** Yellow banner at top, queue badge count, orange/red sync dots.
- **Status badges:** Pill shapes with colored background. Executed=green, Queued=orange, Failed=red, Pending=yellow.
