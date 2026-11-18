import { describe, expect, it } from 'vitest'
import { FROM_CACHE_GATEWAY, markFromCache, offlineFallbackMarkerPlugin } from '../swCacheFallback'

describe('markFromCache', () => {
  it('copies the response with the marker and keeps status, headers and body', async () => {
    const cached = new Response(JSON.stringify({ id: 7 }), {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/json', 'X-App-Version': '1.2.3' },
    })
    const marked = await markFromCache(cached, FROM_CACHE_GATEWAY)
    expect(marked.status).toBe(200)
    expect(marked.statusText).toBe('OK')
    expect(marked.headers.get('X-From-Cache')).toBe('1')
    expect(marked.headers.get('X-App-Version')).toBe('1.2.3')
    expect(await marked.json()).toEqual({ id: 7 })
  })
})

describe('offlineFallbackMarkerPlugin', () => {
  it('marks a cached response NetworkFirst falls back to as an offline copy', async () => {
    const cachedResponse = new Response('{}', { status: 200 })
    const used = await offlineFallbackMarkerPlugin.cachedResponseWillBeUsed({ cachedResponse })
    expect(used.headers.get('X-From-Cache')).toBe('offline')
  })

  it('passes a cache miss through (no response to mark)', async () => {
    const used = await offlineFallbackMarkerPlugin.cachedResponseWillBeUsed({ cachedResponse: null })
    expect(used).toBeNull()
  })
})
