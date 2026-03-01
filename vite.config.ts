import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          if (id.includes('@supabase/supabase-js')) return 'supabase'
          if (id.includes('react-router') || id.includes('react-router-dom')) return 'router'
          if (id.includes('@radix-ui')) return 'radix'
          if (id.includes('react-qr-code') || id.includes('react-qr-reader') || id.includes('qrcode')) return 'qr'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('/react/') || id.includes('/react-dom/')) return 'react'
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
