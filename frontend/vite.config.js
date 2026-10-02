import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { buildAssets } from './buildAssets.js'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), buildAssets()],
  resolve: { alias: mode === 'browser-test' ? { '@asgardeo/auth-react': fileURLToPath(new URL('./e2e/mock-auth.jsx',import.meta.url)) } : {} },
}))
