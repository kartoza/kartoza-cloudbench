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
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})

console.log(defineConfig)
