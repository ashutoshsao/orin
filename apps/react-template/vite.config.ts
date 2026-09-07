import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The dev server runs inside an E2B sandbox and is reached through E2B's
    // proxy at <port>-<sandboxId>.e2b.app; allow that domain past Vite's
    // host check (which otherwise blocks the unrecognized Host header).
    allowedHosts: ['.e2b.app'],
  },
})
