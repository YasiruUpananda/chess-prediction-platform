import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'
import { buildAssets } from './buildAssets.js'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  define: mode === 'browser-test' ? { 'import.meta.env.VITE_ENABLE_BROWSER_METRICS': JSON.stringify('true') } : {},
  plugins: [react(), babel({ presets: [reactCompilerPreset({ compilationMode: 'annotation' })] }), buildAssets()],
  // Test mode replaces the SDK: never share its optimizer output with real dev sessions.
  cacheDir: mode === 'browser-test' ? 'node_modules/.vite-browser-test' : 'node_modules/.vite',
  optimizeDeps: { include: [
    ...(mode === 'browser-test' ? [] : ['@asgardeo/auth-react']),
    '@reduxjs/toolkit', '@reduxjs/toolkit/query/react', 'react-redux',
    'chess.js', 'react-chessboard', 'react-pdf',
  ] },
  resolve: { alias: mode === 'browser-test' ? { '@asgardeo/auth-react': fileURLToPath(new URL('./e2e/mock-auth.jsx',import.meta.url)) } : {} },
}))
