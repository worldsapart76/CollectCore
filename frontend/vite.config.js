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
]

const proxy = Object.fromEntries(PROXY_PATHS.map(p => [p, BACKEND]))

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    proxy,
  },
})
