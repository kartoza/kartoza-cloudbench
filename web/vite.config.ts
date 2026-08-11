import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), cesium()],
  base: process.env.VITE_BASE_URL ?? '',
  build: {
    outDir: '../static',
    emptyOutDir: true
  },
  server: {
    allowedHosts: ['webpack_cloudbench', 'localhost'],
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
    // Start transforming the entry point (and everything it imports —
    // Cesium, MapLibre, Chakra UI, CodeMirror, ...) as soon as the dev
    // server boots, instead of only starting that work when the browser's
    // first request arrives. Same total one-time cold-start cost on a
    // fresh node_modules, but it overlaps with you switching to the
    // browser instead of happening invisibly behind a blank tab.
    warmup: {
      clientFiles: ['./src/main.tsx'],
    },
  },
})

console.log(defineConfig)
