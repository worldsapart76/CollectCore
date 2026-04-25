import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ─── Backend proxy paths ───────────────────────────────────────────────────────
// Every path prefix that the backend handles must be listed here.
// Omitting a path causes requests to return HTML (index.html) instead of JSON,
// which produces the error: Unexpected token '<', "<!doctype "... is not valid JSON
//
// When adding a new module, add its route prefix to this list.
// ──────────────────────────────────────────────────────────────────────────────
const BACKEND = 'http://localhost:8001'
const PROXY_PATHS = [
  '/health',
  '/categories',
  '/ownership-statuses',
  '/consumption-statuses',
  '/ingest',
  '/photocards',
  '/books',
  '/graphicnovels',
  '/videogames',
  '/music',
  '/video',
  '/boardgames',
  '/ttrpg',
  '/export',
  '/admin',
  '/settings',
  '/upload-cover',
  '/images',
  '/shutdown',
  '/catalog',
]

// Frontend sub-paths that share a prefix with backend routes.
// These must NOT be proxied — Vite should serve index.html so React Router handles them.
const FRONTEND_SUBPATHS = new Set(['/library', '/add'])

const proxy = Object.fromEntries(PROXY_PATHS.map(p => [p, {
  target: BACKEND,
  bypass(req) {
    const path = req.url.split('?')[0]
    for (const sub of FRONTEND_SUBPATHS) {
      if (path.endsWith(sub)) return '/index.html'
    }
  },
}]))

// Build modes:
//   default ("npm run build")          → web bundle for Railway. Outputs to
//     backend/frontend_dist/ which is committed to git so Railway picks it up
//     on deploy and FastAPI serves it from the apex domain.
//   "npm run build:mobile" (mode=mobile) → Capacitor APK bundle. Outputs to
//     dist/ where `cap sync android` expects it; uses relative asset paths
//     because the WebView loads the bundle from the device filesystem.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'mobile' ? './' : '/',
  build: {
    outDir: mode === 'mobile' ? 'dist' : '../backend/frontend_dist',
    emptyOutDir: true,
  },
  server: {
    port: 5181,
    proxy,
  },
}))
