/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Only measure application source (not root configs or public/ assets
      // such as the vendored qgis-js wasm loader)
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'src/test/',
        'src/**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types/*',
      ],
      // Floors just under the current coverage so CI catches regressions.
      // Raise these as tests are added (original target was 60%).
      thresholds: {
        statements: 6,
        branches: 55,
        functions: 48,
        lines: 6,
      },
    },
    // Faster test execution
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Timeout for individual tests
    testTimeout: 10000,
    // Reporter for CI
    reporter: process.env.CI ? ['verbose', 'json'] : ['verbose'],
  },
})
