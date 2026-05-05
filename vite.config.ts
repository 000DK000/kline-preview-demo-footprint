import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      // Use the local library source so changes in `KLineChart/src` HMR-update the preview.
      klinecharts: path.resolve(__dirname, '../KLineChart/src/index.ts')
    }
  },
  optimizeDeps: {
    exclude: ['klinecharts']
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')]
    },
    proxy: {
      '/binance': {
        target: 'https://api.binance.com',
        changeOrigin: true,
        rewrite: p => p.replace(/^\/binance/, '')
      }
    }
  }
})

