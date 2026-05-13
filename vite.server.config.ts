import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@shared': resolve('src/shared')
    }
  },
  build: {
    emptyOutDir: true,
    outDir: 'out/server',
    ssr: 'src/server/index.ts',
    rollupOptions: {
      external: ['better-sqlite3'],
      output: {
        entryFileNames: 'index.mjs'
      }
    }
  }
})
