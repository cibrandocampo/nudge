export default async function globalSetup() {
  // Seed runs against the backend regardless of which frontend port tests
  // use. Swap any `:<port>` suffix with `:8000` so the helper works for both
  // the dev (5173) and preview (4173) URLs that Playwright projects target.
  const base = process.env.BASE_URL ?? 'http://localhost:5173'
  const apiBase = base.replace(/:\d+(?=\b|\/|$)/, ':8000')
  const res = await fetch(`${apiBase}/api/internal/e2e-seed/`, { method: 'POST' })
  if (res.status !== 204) {
    throw new Error(
      `E2E seed failed: expected 204, got ${res.status}. ` +
        `Ensure backend is running and E2E_SEED_ALLOWED=true or DJANGO_DEBUG=True.`,
    )
  }
}
