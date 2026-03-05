# LifeOS — Clean UI Improvement Plan

A phased plan to make the app look **clean, consistent, and well-designed** across all screens.

---

## 1. Design system (single source of truth)

**Goal:** One palette, typography scale, and spacing so every screen feels like the same app.

### 1.1 Unify the theme

- **Current issue:** Three overlapping palettes — `Colors`, `ScreenColors`, and `CALM` — used in different screens. Tabs use `Colors`, Settings/Home use `ScreenColors`, AI/Landing use `CALM`.
- **Action:**
  - Pick **one** primary palette (e.g. extend `ScreenColors` or refactor into a single `AppTheme`).
  - Add a **brand accent** (one primary color for buttons, links, active states) and use it everywhere.
  - Define **surfaces**: `background`, `surface` (cards/panels), `surfaceElevated` (modals/sidebar), `border`, `divider`.
  - Keep **semantic** colors: `success`, `warn`, `danger`, `primary` for actions.

### 1.2 Typography scale

- **Current:** Mix of `Typography.*` and inline `fontSize`/`fontWeight`.
- **Action:**
  - Use **only** the theme typography tokens (e.g. `title1`, `body`, `footnote`).
  - Add **line heights** to each token (e.g. body 17/24).
  - Optional: introduce a **display** style for hero titles (landing, empty chat).

### 1.3 Spacing and layout

- **Current:** `Spacing.screenPadding` (20) is good; some screens use ad‑hoc values.
- **Action:**
  - Standardize: **screen padding** 20–24px, **section spacing** 24px, **item spacing** 12px.
  - Standardize **radii**: cards 12–16px, buttons 12px, chips/pills 20px (or full round).
  - Use **elevation/shadow** only for floating elements (tab bar, modals, FABs).

### 1.4 Dark mode

- **Action:** Ensure every color has a dark variant; avoid hardcoded hex outside theme. Test all main screens in dark mode.

---

## 2. Screen-by-screen improvements

### 2.1 Bootstrap / Loading (`app/index.tsx`)

- **Current:** Plain spinner + “Loading…” on `calm.tealBg`.
- **Improvements:**
  - Use **background** from design system (not chat-specific teal).
  - Optional: small logo or app name, centered spinner, single line of copy.
  - Optional: very subtle branding (e.g. “LifeOS” in footnote style).

### 2.2 Landing (`(auth)/landing.tsx`)

- **Current:** Gradient (CALM), title, bullet list, one button.
- **Improvements:**
  - **Hero:** One clear headline; subtitle with comfortable line-height and max-width for readability.
  - **Features:** Replace bullets with simple icons or short cards (icon + one line) for a cleaner look.
  - **CTA:** One primary button (full-width or prominent), proper padding and radius from design system.
  - **Layout:** Consistent padding; optional “Already have an account? Sign in” link.
  - **Background:** Either a single brand color or a very subtle gradient; avoid busy gradients.

### 2.3 Login (`(auth)/login.tsx`)

- **Current:** Gradient, back link, title, subtitle, Google button.
- **Improvements:**
  - Reuse landing’s background and typography.
  - “Back” as text or icon-only; same padding as rest of app.
  - Single primary “Continue with Google” button; loading state inline (no layout shift).
  - Short, clear error message area (red footnote) if sign-in fails.

### 2.4 AI / Chat (`AiScreen.tsx`)

- **Current:** Gradient background, custom CALM colors, dense header, many inline styles.
- **Improvements:**
  - **Background:** Solid `background` or very subtle gradient; avoid strong color.
  - **Header:** Clear hierarchy (e.g. menu | title + status | new chat). Consistent height, padding, and divider.
  - **Messages:**
    - **Bubbles:** Same radius (e.g. 16–20px), max-width ~85%, consistent padding.
    - **User:** One accent color (e.g. primary); text white or high-contrast.
    - **Assistant:** Neutral surface (e.g. `surface` or `surfaceElevated`), same radius.
  - **Actions (Copy, Speak, Follow up):** Secondary style (e.g. text or outlined), not too many colors.
  - **Empty state:** Centered; one short greeting, one subtitle, 3–4 suggestion chips with same style (e.g. outline or soft fill).
  - **Input bar:** Single row (voice + input + send); input with clear border or fill; send button one color when active.
  - **Sidebar:** Same surface/elevation as rest of app; “New chat” prominent; list items with title + date; selected state subtle (e.g. background tint).

### 2.5 Dashboard / Home (`HomeScreen.tsx`)

- **Current:** Cards and quick actions; functional but visually mixed.
- **Improvements:**
  - **Top:** One status strip or cards (sleep, hydration, focus) with **same card style** (padding, radius, border or shadow).
  - **Progress:** Hydration (and others) as clear progress bars or rings; one style for all.
  - **Quick actions:** Same button/chip style (e.g. “Log 250 ml”).
  - **Sections:** Section titles with same typography (e.g. headline); consistent spacing between sections.
  - **Offline banner:** Small, non-intrusive (e.g. footnote + icon at top).

### 2.6 Settings / More (`SettingsScreen.tsx`)

- **Current:** Long scroll, many sections, mixed card styles.
- **Improvements:**
  - **Structure:** One **screen title** at top; sections as **grouped lists** (Account, Connection, Preferences, Data, About).
  - **Rows:** List rows with **consistent height**, left label, right value or control; optional chevron for drill-down.
  - **Cards:** Use one **card** style (or no card, just dividers) for each group; avoid multiple card styles on one screen.
  - **Buttons:** Primary for main actions (e.g. Sign in), destructive for Disconnect/Clear; secondary for Sync/Copy URI.
  - **Dev hints:** Collapse behind “Developer” or “Advanced” so the main flow stays clean.

### 2.7 Tab bar (`(tabs)/_layout.tsx`)

- **Current:** Functional; different from rest of app palette.
- **Improvements:**
  - Use **design system** background and border (e.g. `surface` or `surfaceElevated`).
  - **Active tab:** Brand accent color; **inactive:** neutral (e.g. `sub` or `tertiaryLabel`).
  - **Icons:** Same size; optional subtle label.
  - Optional: slight top shadow or border so it feels “on top”.

---

## 3. Reusable components

Build or refactor these so screens stay consistent:

| Component        | Purpose                                      |
|------------------|----------------------------------------------|
| **Screen**       | SafeAreaView + background; optional title.   |
| **Card**         | One style: padding, radius, background, optional border. |
| **ListRow**      | Label + optional value/control + optional chevron. |
| **PrimaryButton**| Full-width or inline; loading state.         |
| **SecondaryButton** | Outline or text; for secondary actions.  |
| **Chip**         | Rounded pill for suggestions/tags.           |
| **StatusBadge**  | Small dot + text (e.g. Online, Offline).      |
| **Input**        | Text input with border/fill from theme.      |

Use design-system colors and spacing in all of them; avoid screen-specific colors inside components.

---

## 4. Implementation order

1. **Theme and design tokens**  
   Refactor `constants/theme.ts` (and optionally `useAppTheme`) so there is one `AppTheme` (light/dark) with: colors, typography, spacing, radii. No new screens yet.

2. **Shared components**  
   Add or update `Screen`, `Card`, `ListRow`, `PrimaryButton`, `SecondaryButton`, `Chip` in `components/` using only theme tokens.

3. **Bootstrap and auth**  
   Apply theme + shared components to `index.tsx`, `landing.tsx`, `login.tsx`. Simple, calm layouts.

4. **AI / Chat**  
   Apply theme; simplify AiScreen (background, header, bubbles, input bar, sidebar) and use shared Button/Chip where it fits.

5. **Dashboard**  
   Apply theme and Card/ListRow/Button to HomeScreen; unify status and progress styling.

6. **Settings**  
   Apply theme; regroup into list-style sections; use ListRow and Card consistently.

7. **Tab bar**  
   Switch tab bar to design system colors and optional shadow.

8. **Polish**  
   Pass over all screens: remove redundant styles, fix dark mode, align spacing and typography.

---

## 5. Quick wins (minimal code)

- Replace scattered `calm.*` / `c.*` with a **single** palette (e.g. always `screen` from `useAppTheme()`).
- Replace inline `fontSize`/`fontWeight` with **Typography** tokens.
- Use **Spacing** constants everywhere (no magic 8, 10, 16).
- Give all cards the **same** border radius and padding (e.g. 12–16px radius, 16px padding).
- Make primary actions **one** color (e.g. primary blue or teal) across auth, chat, and settings.

---

## 6. Out of scope (for later)

- Custom illustrations or mascot.
- Animations beyond basic opacity/scale.
- Major navigation changes (e.g. drawer instead of tabs).
- Theming beyond light/dark (e.g. custom accent picker).

---

**Next step:** Implement **§1 Design system** and **§3 Reusable components** first; then apply them screen by screen in the order of §4.
