import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: ['pdf-lib'] })] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()], publicDir: resolve(__dirname, 'node_modules/pdfjs-dist/web/images'), build: { assetsInlineLimit: 0 } }
})
