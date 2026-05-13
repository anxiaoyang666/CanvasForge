/// <reference types="vite/client" />

import type { CanvasForgeAPI } from '@shared/types'

declare global {
  interface Window {
    canvasForge: CanvasForgeAPI
  }
}
