---
name: frontend-patterns
description: Frontend architecture patterns and conventions for Nudge. Use when creating or modifying React components, pages, API calls, i18n, or CSS modules. Triggers when working on frontend code or when the user asks about frontend conventions.
---

# Frontend Patterns — Nudge

## Reuse first — never define the same thing twice

The single most important rule in this codebase: **if a style, component,
hook, or utility with the same intent already exists, consume it. Do not
re-implement. Do not duplicate.**

The corollary: **when designing something new, think abstract → concrete.**
If the thing has reuse potential (it is a modal frame, a date formatter,
an escape-key handler), build the primitive first and use it from the
concrete consumer. Don't write 5 local copies and "refactor later" — the
"later" never comes, and the drift becomes a full-day sweep (see
`docs/plans/frontend-homogenization.md`).

### Pre-write checklist

Before creating ANY new frontend code, grep the layers below in this order
and extend / consume what matches. If nothing matches, decide whether this
belongs in the shared layer (most things with ≥ 2 future consumers do) or
is a true page-specific one-off.

1. **Design tokens** — `src/index.css` (`--c-*`, `--shadow-*`, `--radius-*`,
   `--transition`). Never hardcode a color, shadow, radius, or transition
   that maps to an existing token.
2. **Shared CSS classes** — `src/styles/shared.module.css`. Covers buttons
   (`.btn*`, `.btnIcon*`, `.btnAdd*`, `.btnCancel`, `.btnConfirm`,
   `.btnIconMd/Lg`), inputs, cards, overlays, modal boxes, forms
   (`.formSection*`, `.formChip*`, `.formToggle*`, `.formFooter`), status
   dots, typography (`.pageTitle`, `.sectionTitle`, `.helpText`, `.muted`,
   `.error`).
3. **Shared components** — `src/components/`. Notable primitives:
   `ModalFrame`, `Icon`, `AlertBanner`, `OfflineBanner`, `Toast`,
   `SharePopover`, `ShareWithSection`, `IntervalPicker`, `DateRangePicker`,
   `Combobox`, `PendingBadge`.
4. **Shared hooks** — `src/hooks/`. TanStack Query data hooks
   (`useRoutines`, `useStock`, `useMe`…), `useEscapeKey`,
   `useClickOutside`, `useServerReachable`, `usePushStatus`,
   `useOfflineMutation`.
5. **Shared utils** — `src/utils/`. `cx` (classnames), `time`
   (`formatShortDate`, `formatAbsoluteDate`, `formatRelativeTime`,
   `getLocale`), `number` (`parseIntSafe`), `interval` (`hoursToHuman`,
   `toHours`), `push`, `auth`, `diffPayloads`.

When a new helper fits conceptually into an existing module, add it there
(a new date helper joins `utils/time.js`, not a new `utils/date.js`).

### The 1 / 2 / 3 rule

- **1 occurrence**: local code is fine.
- **2 occurrences**: acceptable only if disparate intent. If the intent
  matches, extract before the second lands.
- **3 occurrences**: technical debt. Must extract before merging the third.

This is the concretization of CLAUDE.md's "three similar lines is better
than a premature abstraction" — the third occurrence is where the pattern
has proven itself and the abstraction earns its keep.

### When NOT to abstract

- Single usage with no visible future twin → keep local.
- Superficially similar but semantically different (two buttons that share
  padding but mean different things) → extract **shape**, not **context**.
  The shape goes to shared; the context stays local.
- The abstraction needs to grow 4 props and 3 if-branches to fit every
  consumer → it's the wrong shape. Split it, or inline.

### Concrete examples already applied in this repo

- **`<ModalFrame>`** (`components/ModalFrame.jsx`) replaces 5 copies of
  overlay + modalBox + Escape handler + click-outside that used to live
  in `ConfirmModal`, `ShareModal`, `GroupPickerModal`, `LotSelectionModal`,
  `ChangePasswordModal`. New modals always go through it.
- **`useEscapeKey` / `useClickOutside`** (`hooks/`) — one hook instead of
  the same `useEffect` scaffolding in every modal/popover.
- **`formatShortDate`** (`utils/time.js`) — consolidates the
  `formatDepletionDate` that used to be triple-copied across `StockCard`,
  `StockDetailPage`, `InventoryPage`.
- **`.btnCancel` / `.btnConfirm`** (`shared.module.css`) — a single source
  of truth for modal action buttons; previously each modal defined its
  own local `.cancelBtn` / `.confirmBtn`.
- **`.btnIcon` / `.btnIconMd` / `.btnIconLg`** — 32 / 36 / 40 px icon
  button variants with documented convention (in-card / form-level /
  top-bar triggers). No more hardcoded `width: 36px; height: 36px;` in
  page-local CSS.
- **`--shadow-sm/md/lg` and `--radius-sm/lg/xl/xxl`** tokens in
  `index.css` — no more raw `0 6px 20px rgba(...)` or `border-radius:
  12px` in module CSS.

These are the kind of wins to protect. If you find yourself writing
something that could be one of these — stop, find the existing primitive
or propose it first.

## Architecture

- **Vite + React** SPA with CSS Modules (`.module.css`)
- **PWA** via `vite-plugin-pwa` with `injectManifest` strategy
- **Routing**: React Router v6 (`frontend/src/App.jsx`)
- **Auth**: JWT stored in `localStorage`, managed by `AuthContext`
- **i18n**: `react-i18next` with JSON translation files in `src/i18n/`
- **API client**: custom fetch wrapper in `src/api/client.js`
- **Icons**: `lucide-react` — use named imports: `import { Plus, X, ChevronDown } from 'lucide-react'`

## API client

All API calls go through `src/api/client.js`:

```js
import { api } from '../api/client'

const res = await api.get('/auth/me/')
const res = await api.post('/push/subscribe/', { endpoint, keys })
const res = await api.patch('/auth/me/', { timezone: 'Europe/Madrid' })
const res = await api.delete('/push/unsubscribe/', { endpoint })
```

- `BASE_URL` defaults to `/api` — paths are relative (e.g., `/auth/me/` becomes `/api/auth/me/`)
- Auto-refreshes JWT on 401 using a mutex to prevent duplicate refresh requests
- Always include trailing slashes in paths (Django requires them)

## CSS conventions

- Use CSS Modules: `import s from './MyComponent.module.css'`
- Shared styles in `src/styles/shared.module.css`
- Design tokens as CSS custom properties in `src/index.css`:
  - `--c-primary: #6366f1` (indigo)
  - `--c-text`, `--c-text-2`, `--c-text-3` (grays)
  - `--c-muted` (secondary text)
  - `--c-danger`, `--c-success`, `--c-warning`
  - `--c-bg`, `--c-surface`, `--c-border`
- Use `cx()` utility (`src/utils/cx.js`) for conditional classes
- **Never use `--c-accent`** — use `--c-primary` instead

### Typography scale (6 values only)

| Value | Use |
|-------|-----|
| `0.7rem` | Section labels (`shared.sectionTitle`) |
| `0.8rem` | Error/muted small text |
| `0.875rem` | Body text, inputs, list items |
| `0.9rem` | Secondary labels |
| `1rem` | Modal/card titles |
| `1.25rem` | Page titles (`shared.pageTitle`) |

### Layout

- All page containers: `max-width: 540px` (enforced in `Layout.module.css`)
- Page top bar: use `shared.topBar` (flex, space-between, `margin-bottom: 1.5rem`)

### Buttons — 3 standard sizes

```css
/* CTA / primary action */
padding: 0.75rem 1.25rem; border-radius: 8px; font-size: 0.875rem;

/* Inline / secondary */
padding: 0.5rem 1rem; border-radius: 8px; font-size: 0.875rem;

/* Modal action (confirm/cancel pair) */
padding: 0.6rem 1.25rem; border-radius: 8px; font-size: 0.875rem;
```

### Inputs

- Always use `background: var(--c-surface)` (never `var(--c-bg)` or `white`)
- Use `shared.input` for standard text inputs

### Spinner (loading state)

Use `shared.spinner` div with `data-testid="spinner"`:

```jsx
<div className={shared.spinner} data-testid="spinner" />
```

Tests must query by `data-testid="spinner"`, NOT by "Loading…" text.

## i18n

Three languages: `en`, `es`, `gl`. Translation files in `src/i18n/`.
Always use translation keys, never hardcode user-facing strings:

```jsx
const { t } = useTranslation()
<button>{t('settings.saveChanges')}</button>
```

When adding a feature, add keys to ALL three JSON files.

## Component patterns

### Pages

Pages live in `src/pages/`. Each page is a default export function component.
Tests in `src/pages/__tests__/`.

### Shared components

In `src/components/`. Each has its own `.module.css`.
Tests in `src/components/__tests__/`.

### Modal pattern

Always use `shared.overlay` + `shared.modalBox`. Modal structure:

```jsx
<div className={shared.overlay} onClick={onClose} role="dialog" aria-modal="true">
  <div className={shared.modalBox} onClick={e => e.stopPropagation()}>
    <div className={s.header}>
      <h2 className={s.title}>{t('...')}</h2>
      <button className={s.xBtn} onClick={onClose}>✕</button>
    </div>
    <p className={s.subtitle}>{t('...')}</p>
    {/* content */}
  </div>
</div>
```

- **No "Cancel" button inside modals** — use an ✕ button in the top-right of the header instead
- Add a subtitle (`<p className={s.subtitle}>`) below the title for context
- `shared.modalBox` is `max-width: 360px`, `border-radius: 12px`, `padding: 1.5rem`
- Use `shared.modalTitle` for the title if no custom header layout is needed

Header + xBtn pattern CSS:

```css
.header { display: flex; align-items: center; justify-content: space-between; margin: 0 0 0.25rem; }
.title { margin: 0; font-size: 1rem; font-weight: 700; color: var(--c-text); letter-spacing: -0.01em; }
.xBtn { background: none; border: none; font-size: 1rem; color: var(--c-text-3); cursor: pointer; padding: 0.1rem 0.25rem; line-height: 1; }
.xBtn:hover { color: var(--c-text); }
.subtitle { margin: -0.5rem 0 1rem; font-size: 0.825rem; color: var(--c-muted); }
```

### Selectable list items (radio / multi-select)

Used in LotSelectionModal, GroupPickerModal, ShareModal. Standard row:

```css
.item {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--c-border); border-radius: 8px;
  cursor: pointer; user-select: none;
  transition: border-color 0.12s, background 0.12s;
}
.item:hover { border-color: var(--c-primary); }

/* Radio (single-select): tinted background */
.itemSelected { border-color: var(--c-primary); background: color-mix(in srgb, var(--c-primary) 8%, transparent); }

/* Toggle (multi-select): full primary fill */
.itemSelected { border-color: var(--c-primary); background: var(--c-primary); }
.itemSelected .name { color: var(--c-surface); font-weight: 600; }
```

Radio indicator dot:

```css
.radio {
  width: 1.75rem; height: 1.75rem;
  border: 2px solid var(--c-border); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.1rem; color: var(--c-primary); flex-shrink: 0;
}
.itemSelected .radio { border-color: var(--c-primary); }
```

### Active-state buttons (share / group tag)

Buttons that reflect an active/assigned state use opacity:

```css
.btn { opacity: 0.3; }
.btnActive { opacity: 1; }
```

### Testing

- **Vitest** + **React Testing Library** + **MSW** (Mock Service Worker)
- Render helper: `renderWithProviders()` from `src/test/helpers.jsx`
  (wraps with Router, AuthContext, i18n)
- MSW handlers in `src/test/mocks/handlers.js`
- Mock user has `timezone: 'Europe/Madrid'`, `language: 'en'`

### Required for every new frontend feature

1. **Add MSW handlers** for any new API endpoints in `src/test/mocks/handlers.js`.
2. **Write new tests** in the relevant `__tests__/` file covering: renders correctly,
   user interactions (clicks, form submits), error states, loading states, and any
   conditional rendering logic.
3. **Run the full suite** and confirm no regressions.
4. **Update `frontend-patterns` SKILL.md** if a new pattern or convention is introduced.

### Native `<select>` scroll quirk

Safari and some browsers don't auto-scroll a `<select size=N>` to show the
selected `<option>`. Fix with a `useEffect` + `useRef`:

```jsx
useEffect(() => {
  const el = selectRef.current
  if (!el) return
  const raf = requestAnimationFrame(() => {
    const idx = options.indexOf(selectedValue)
    if (idx >= 0) el.selectedIndex = idx
  })
  return () => cancelAnimationFrame(raf)
}, [selectedValue, options])
```

`requestAnimationFrame` is needed for client-side navigation timing.

## Testing caveats

- jsdom (used by Vitest) does NOT implement `scrollIntoView`, `IntersectionObserver`,
  or other layout APIs. Guard these calls or use `requestAnimationFrame` wrappers.
- Push notification tests mock `navigator.serviceWorker.ready` — the real SW is not
  available in jsdom.
- Frontend test helpers are in `frontend/src/test/helpers.jsx` with MSW handlers in
  `frontend/src/test/mocks/handlers.js`.

## Service Worker

`src/sw.js` handles push notification events (`push`, `notificationclick`).
In dev mode, VitePWA serves it as a module at `/dev-sw.js?dev-sw`.
`devOptions` in `vite.config.js` must be `enabled: true` for push to work in dev.
In production, it's bundled as a classic script at `/sw.js`.
