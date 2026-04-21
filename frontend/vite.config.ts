import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // In production builds (GitHub Pages), assets live under /sokopay/.
  // During local dev the server runs at root so the sub-path is not needed.
  // VITE_BASE_PATH is set by CI:
  //   GitHub Pages workflow → /SokoPay/
  //   Vercel env vars       → / (root deployment)
  //   Local dev             → / (proxy handles /api)
  base: process.env.VITE_BASE_PATH ?? (command === 'build' ? '/SokoPay/' : '/'),
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: '../static',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query'],
          'chart-vendor': ['recharts'],
          'ui-vendor': ['lucide-react', 'qrcode.react', 'date-fns', 'clsx'],
        },
      },
    },
  }
}))
