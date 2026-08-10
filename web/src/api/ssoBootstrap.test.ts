/**
 * Tests for the SSO handoff bootstrap.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { applySsoTokenFromUrl } from './ssoBootstrap'

/**
 * Stub window.location directly rather than relying on history.pushState
 * to update it — happy-dom's URL bookkeeping around relative
 * replaceState calls isn't reliable enough here to test against.
 */
function setLocation(url: string) {
  const parsed = new URL(url)
  Object.defineProperty(window, 'location', {
    value: {
      origin: parsed.origin,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
    },
    writable: true,
    configurable: true,
  })
}

describe('applySsoTokenFromUrl', () => {
  beforeEach(() => {
    localStorage.clear()
    // Mirror a real browser: replaceState updates window.location.
    vi.spyOn(window.history, 'replaceState').mockImplementation(
      (_state, _title, url) => {
        if (url) {
          setLocation(String(url))
        }
      },
    )
  })

  it('stores the token from the URL into localStorage', () => {
    setLocation('http://localhost/?token=abc123')

    applySsoTokenFromUrl()

    expect(localStorage.getItem('token')).toBe('abc123')
  })

  it('strips the token param from the visible URL, keeping the rest', () => {
    setLocation('http://localhost/dashboard?token=abc123&tab=layers')

    applySsoTokenFromUrl()

    expect(window.location.search).toBe('?tab=layers')
    expect(window.location.pathname).toBe('/dashboard')
  })

  it('does nothing when there is no token param', () => {
    setLocation('http://localhost/?tab=layers')

    applySsoTokenFromUrl()

    expect(localStorage.getItem('token')).toBeNull()
    expect(window.location.search).toBe('?tab=layers')
  })
})
