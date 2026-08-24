import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // `@/…` → src/…, the alias shadcn/ui components import through.
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
})
