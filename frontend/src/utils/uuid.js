/**
 * A v4 UUID, in every context the app actually runs in.
 *
 * `crypto.randomUUID` exists only in a **secure context**, and self-hosting
 * over plain HTTP on a LAN (a NAS, a Raspberry Pi) is a supported setup — see
 * `hooks/useScannerAvailable.js`, which treats it as a first-class case. There
 * the property is simply absent, so calling it throws a TypeError and takes
 * down every mutation, not just the feature that needed an id.
 *
 * `crypto.getRandomValues`, unlike `randomUUID`, is *not* restricted to secure
 * contexts, so the fallback keeps real randomness rather than degrading to
 * `Math.random`. The last resort exists only for exotic runtimes with no Web
 * Crypto at all; it is weaker, but a colliding id is still better than a crash.
 */
export function randomUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  // Version 4, variant 10xx — the bits that make it a valid random UUID.
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}
