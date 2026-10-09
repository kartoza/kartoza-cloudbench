/**
 * Vitest test setup file.
 * Configures the testing environment for React components.
 */

import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { setupServer } from 'msw/node'

// Mock handlers for MSW (Mock Service Worker)
import { handlers } from './mocks/handlers'

// Create MSW server for API mocking
export const server = setupServer(...handlers)

// Start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))

// Reset handlers after each test
afterEach(() => {
  cleanup()
  server.resetHandlers()
})

// Close server after all tests
afterAll(() => server.close())

// user-event redefines HTMLElement.prototype.focus/blur as getter-only, and
// happy-dom's prototype outlives a test file (vitest.config singleFork). In
// the next file Chakra's focus-visible assigns HTMLElement.prototype.focus,
// which then throws ("only a getter") and leaves React broken for every file
// after it ("Should not already be working."). Make them assignable again.
for (const name of ['focus', 'blur'] as const) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)
  if (descriptor?.get && !descriptor.set) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      writable: true,
      value: descriptor.get.call(HTMLElement.prototype),
    })
  }
}

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  root = null
  rootMargin = ''
  thresholds = []

  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

// Mock URL.createObjectURL
URL.createObjectURL = () => 'mock-url'
URL.revokeObjectURL = () => {}

// Suppress console errors in tests (optional)
// const originalError = console.error
// console.error = (...args: any[]) => {
//   if (args[0]?.includes?.('Warning:')) return
//   originalError.call(console, ...args)
// }
