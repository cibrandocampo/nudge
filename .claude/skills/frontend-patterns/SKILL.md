---
name: frontend-patterns
description: Frontend architecture patterns and conventions for Nudge. Use when creating or modifying React components, pages, API calls, i18n, or CSS modules. Triggers when working on frontend code or when the user asks about frontend conventions.
---

# Frontend Patterns — Nudge

## Architecture

- **Vite + React** SPA with CSS Modules (`.module.css`)
- **PWA** via `vite-plugin-pwa` with `injectManifest` strategy
- **Routing**: React Router v6 (`frontend/src/App.jsx`)
- **Auth**: JWT stored in `localStorage`, managed by `AuthContext`
- **i18n**: `react-i18next` with JSON translation files in `src/i18n/`
- **API client**: custom fetch wrapper in `src/api/client.js`

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
  - `--c-danger`, `--c-success`, `--c-warning`
  - `--c-bg`, `--c-surface`, `--c-border`
- Use `cx()` utility (`src/utils/cx.js`) for conditional classes

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

## Service Worker

`src/sw.js` handles push notification events (`push`, `notificationclick`).
In dev mode, VitePWA serves it as a module at `/dev-sw.js?dev-sw`.
`devOptions` in `vite.config.js` must be `enabled: true` for push to work in dev.
In production, it's bundled as a classic script at `/sw.js`.
