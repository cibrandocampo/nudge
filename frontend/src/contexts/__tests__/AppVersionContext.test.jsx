import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { publishRemoteVersion } from '../appVersionBridge'
import { AppVersionProvider, useAppVersion } from '../AppVersionContext'

function wrapper({ children }) {
  return <AppVersionProvider>{children}</AppVersionProvider>
}

describe('AppVersionContext', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_APP_VERSION', '1.0.0')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('exposes updateAvailable=false when no remote version has been seen', () => {
    const { result } = renderHook(() => useAppVersion(), { wrapper })
    expect(result.current.updateAvailable).toBe(false)
    expect(result.current.localVersion).toBe('1.0.0')
    expect(result.current.latestVersion).toBeNull()
  })

  it('keeps updateAvailable=false when the remote version matches the local one', () => {
    const { result } = renderHook(() => useAppVersion(), { wrapper })
    act(() => {
      publishRemoteVersion('1.0.0')
    })
    expect(result.current.updateAvailable).toBe(false)
    expect(result.current.latestVersion).toBe('1.0.0')
  })

  it('flips updateAvailable=true when the remote version differs', () => {
    const { result } = renderHook(() => useAppVersion(), { wrapper })
    act(() => {
      publishRemoteVersion('1.1.0')
    })
    expect(result.current.updateAvailable).toBe(true)
    expect(result.current.latestVersion).toBe('1.1.0')
  })

  it('does not re-render when the same remote version is published twice', () => {
    let renders = 0
    function Probe() {
      renders++
      useAppVersion()
      return null
    }
    render(
      <AppVersionProvider>
        <Probe />
      </AppVersionProvider>,
    )
    const baseline = renders
    act(() => {
      publishRemoteVersion('1.1.0')
    })
    const afterFirst = renders
    act(() => {
      publishRemoteVersion('1.1.0')
    })
    expect(afterFirst).toBeGreaterThan(baseline)
    expect(renders).toBe(afterFirst)
  })

  it('throws when useAppVersion is called outside the provider', () => {
    expect(() => renderHook(() => useAppVersion())).toThrow(/AppVersionProvider/)
  })
})
