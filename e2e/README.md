# Nudge — End-to-end tests (Playwright)

Two browser projects share one codebase:

| Project | Target | Use it for |
|---|---|---|
| `chromium-dev` | Vite dev server (`localhost:15173`, HMR) | Fast iteration on a feature spec |
| `chromium-preview` | Vite preview of the production build (`localhost:14173`) | Anything PWA / Service Worker (`offline-*.spec.js`) — the dev server does not precache the SW manifest |

`playwright.config.js` enforces the split: `chromium-preview` only runs
`offline-*.spec.js`; `chromium-dev` runs everything else.

## Canonical invocation

The e2e container reaches the app **via the host network**, NOT via
`host.docker.internal`. Use `--network=host` and a `localhost` BASE_URL:

```bash
# Preview (offline / SW-dependent specs)
docker run --rm --network=host \
  -e BASE_URL=http://localhost:14173 \
  -e DEMO_USERS_PASSWORD=change-me \
  -v "$(pwd)/e2e/tests:/e2e/tests" \
  -v "$(pwd)/e2e/playwright.config.js:/e2e/playwright.config.js" \
  -v "$(pwd)/e2e/global-setup.js:/e2e/global-setup.js" \
  nudge-e2e npx playwright test --project=chromium-preview

# Dev (everything else)
docker run --rm --network=host \
  -e BASE_URL=http://localhost:15173 \
  -e E2E_USERNAME=admin \
  -e E2E_PASSWORD=change-me \
  -e DEMO_USERS_PASSWORD=change-me \
  -v "$(pwd)/e2e/tests:/e2e/tests" \
  -v "$(pwd)/e2e/playwright.config.js:/e2e/playwright.config.js" \
  -v "$(pwd)/e2e/global-setup.js:/e2e/global-setup.js" \
  nudge-e2e npx playwright test --project=chromium-dev

# A single test (focused)
… nudge-e2e npx playwright test offline-detail-hydration.spec.js \
  -g "routine detail" --project=chromium-preview --reporter=list
```

The tests bind-mount via the `-v` lines so edits take effect without
rebuilding the image. Only the npm install / browser layers live in the
image — rebuild only when those change:

```bash
docker build -f e2e/Dockerfile -t nudge-e2e ./e2e
```

### Required environment variables

| Var | Why | Default |
|---|---|---|
| `BASE_URL` | Origin Playwright targets. Always `http://localhost:15173` (dev) or `http://localhost:14173` (preview) when running from the e2e container with `--network=host`. | per-project (`localhost:1517X`) |
| `E2E_USERNAME` | Admin username for `login()` in dev specs. | `admin` |
| `E2E_PASSWORD` | Admin password for `login()`. **No default** — without this the dev suite fails at `loginAs` with a 30 s timeout. | (none) |
| `DEMO_USERS_PASSWORD` | Password for the seeded `cibran/maria/laura` users (`SHARED_PASSWORD` in `helpers/constants.js`). | `change-me` |

## Why `--network=host` (and not `host.docker.internal`)

Service Worker registration is gated on a **secure context**. Chromium
treats `localhost`/`127.0.0.1` as secure automatically; everything else
needs `https://` or an explicit allow-list flag. We used to use:

```js
launchOptions.args = ['--unsafely-treat-insecure-origin-as-secure=http://host.docker.internal:14173']
```

That stopped working **around Chromium 145** — `navigator.serviceWorker`
becomes `undefined` even with the flag set verbatim, and
`window.isSecureContext` stays `false`. Confirmed by dropping a
diagnostic spec that printed `swApi/isSecureContext/registrations` and
flipping the network mode: with `host.docker.internal`, `swApi: false,
registrations: 0`; with `--network=host` + `localhost`,
`swApi: true, registrations: 1, active state: "activated"`.

The `--unsafely-treat-insecure-origin-as-secure` arg is still wired in
`playwright.config.js` as a fallback so legacy `host.docker.internal`
invocations don't break loudly, but the supported path is host network.

## Repeated gotchas (cross-reference for new specs)

- **`getByRole('link' | 'button')` is not interchangeable.** Buttons that
  used to be `<Link>` now turn into `<button aria-disabled>` when the
  feature is gated on reachability/permissions (so the click can fire
  the toast). Examples: routine-detail "Edit" pencil (T182). Update
  every locator that targeted the link form when porting tests.

- **CSS module class names are camelCase, not kebab-case.** The
  attribute selector `[class*="lotRow"]` does **not** match
  `_cardLotRow_<hash>` — the substring is case-sensitive and the source
  uses an uppercase L. Prefer `data-testid="lot-row"` (already on the
  element) over class regexes.

- **The lot-number Combobox dropdown overlaps "Add batch".** Pressing
  `Escape` on the input dismisses the listbox via the component's
  `useEscapeKey` hook. `blur()` alone does **not** close it (the
  Combobox closes on `useClickOutside`, which `blur` does not trigger).
  See `helpers/stocks.js#addLot` for the recipe.

- **Combobox is not a `<select>`.** `selectOption()` won't work. The
  pattern is:
  ```js
  await page.getByPlaceholder('Search routines…').click()  // open
  await page.getByRole('option', { name: 'Take antihistamine' }).click()
  ```
  Watch out for conditional rendering: history's Routine/Item filters
  only mount when the parent Type select has the matching value.

- **`page.route` does not intercept fetches made from inside the
  Service Worker.** Use `context.route` for `/api/*` mocks when the SW
  is in the middle (preview project). The `mockApiRoute` helper in
  `helpers/offline.js` already does the right thing.

- **The frontend-preview container is built from a static bundle.**
  After every UI change you want to e2e-cover under preview, rebuild
  it: `docker compose -f dev/docker-compose.yml --profile preview build
  frontend-preview && docker compose ... up -d frontend-preview`.
  Otherwise the preview tests run against a stale build.

- **Each test gets a fresh browser context, but the backend is
  shared.** `playwright.config.js` pins `workers: 1` +
  `fullyParallel: false` to avoid mutation races between dev and
  preview projects hitting the same DB. Don't relax this without
  introducing per-project test data isolation.

- **Don't `page.goto('/X')` while offline if `/X` is route-guarded.**
  T181's `OfflineRouteGuard` swaps `/history` and `/settings` to a
  placeholder when reachable=false, so direct navigation lands on the
  placeholder, not the page. Either: navigate online and then flip
  reachability via `goOffline`, or assert against the placeholder
  directly.

- **`expect(number).toBeGreaterThan(0)` does not retry.** Use
  `expect(locator).toHaveCount(N)` or
  `expect(locator.first()).toBeVisible()` when the DOM is mid-render
  (filter changes, optimistic mutations).

## Common helpers

Located in `e2e/tests/helpers/`:

| Helper | Module | What it does |
|---|---|---|
| `freshSession(page, ctx, { loginAs })` | `session.js` | Wipe cookies + IndexedDB + localStorage, then log in. Required for offline specs that must not inherit queue state. |
| `loginAsUser1` / `loginAsAdmin` / … | `session.js` | Log in via the credentials seeded by `seed.py`. |
| `resetSeed(ctx)` | `session.js` | POST `/api/internal/seed/`. Mutation tests call this in `beforeEach`. |
| `goOffline` / `goOnline` | `offline.js` | Combine `context.setOffline(true/false)` with the `__NUDGE_REACHABILITY_*` window helpers so the banner mounts immediately (no waiting for the 20 s health poll). |
| `waitForServiceWorkerReady` | `offline.js` | After `freshSession`, wait for the SW to install + control the page (`reload()` once if the first activation didn't claim). |
| `expectOfflineBanner({ visible })` | `offline.js` | Assert the banner state. |
| `expectPendingBadge({ count })` | `offline.js` | Assert the offline-queue badge state (`count: 0` means absent from DOM). |
| `waitForSyncDrain` | `offline.js` | Wait for the queue to fully drain (PendingBadge unmounts). |
| `addLot` / `deleteLot` | `stocks.js` | Add or remove a lot via the StockDetailPage form. Knows about the Combobox + dropdown gotchas. |

## Where evidence lives

Per-task evidence (commands + outputs) lives under
`docs/tasks/evidence/TXXX/`. Each `/dev-3-run` execution writes its own
log files there. The `/dev-4-qa` skill re-runs them and produces a
verification table at the bottom of the corresponding task doc.

## Useful one-liners

```bash
# Re-run only failed tests from the last run (preview)
… nudge-e2e npx playwright test --project=chromium-preview --last-failed

# Headed mode for visual debugging (requires --network=host so the
# browser reaches the app, plus DISPLAY forwarding which is host-OS
# specific — easier to just run Playwright on the host with `npx`).

# Watch the live trace of a single test
… nudge-e2e npx playwright test offline-read.spec.js --trace on
```
