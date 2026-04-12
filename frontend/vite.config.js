import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5181,
    proxy: {
      '/health': 'http://localhost:8001',
      '/categories': 'http://localhost:8001',
      '/ownership-statuses': 'http://localhost:8001',
      '/ingest': 'http://localhost:8001',
      '/photocards': 'http://localhost:8001',
      '/books': 'http://localhost:8001',
      '/graphicnovels': 'http://localhost:8001',
      '/videogames': 'http://localhost:8001',
      '/export': 'http://localhost:8001',
      '/admin': 'http://localhost:8001',
      '/images': 'http://localhost:8001',
    },
  },
})
