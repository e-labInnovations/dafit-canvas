import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts: ['dafit-canvas.elabins.com'],
  },
  server: {
    proxy: {
      // Order matters: longer prefix first so /api/moyoung-cdn doesn't get
      // greedily matched by /api/moyoung.
      '/api/moyoung-cdn': {
        target: 'https://api-cdn.moyoung.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/moyoung-cdn/, ''),
      },
      '/api/moyoung': {
        target: 'https://api.moyoung.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/moyoung/, ''),
      },
    },
  },
})
