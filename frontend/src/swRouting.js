/**
 * Where a click on a notification takes the user.
 *
 * Kept out of `sw.js` so it can be tested: a service worker has no test
 * harness here, and this is the part with decisions in it. Vite bundles it
 * into the worker.
 *
 *   - a routine (`routine_id`) opens it, marking it done with `mark-done`;
 *   - a stock (`stock_id`, the regulatory digest about one product) opens its page;
 *   - an in-app `path` (the digest about several) opens that path — only a
 *     same-origin one: `//host` would be read as another site;
 *   - anything else opens the app.
 */
export function notificationTargetUrl(data, action) {
  const routineId = data?.routine_id
  if (routineId) {
    return action === 'mark-done' ? `/routines/${routineId}?action=mark-done` : `/routines/${routineId}`
  }
  if (data?.stock_id) return `/inventory/${data.stock_id}`
  const path = data?.path
  if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')) return path
  return '/'
}
