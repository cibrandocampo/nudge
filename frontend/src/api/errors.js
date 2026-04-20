/**
 * Typed errors thrown by the API client so callers (and the offline queue in
 * T024) can branch on error kind without inspecting response shapes.
 */

export class OfflineError extends Error {
  constructor(originalError) {
    super('Network request failed')
    this.name = 'OfflineError'
    this.originalError = originalError
  }
}

export class ConflictError extends Error {
  /**
   * @param {*} currentPayload  The `current` object the server sent with the
   *   412 response (i.e. the fresh server state the client should reconcile
   *   against).
   */
  constructor(currentPayload) {
    super('Resource was modified by another user')
    this.name = 'ConflictError'
    this.current = currentPayload
  }
}
