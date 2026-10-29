import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      // Matches the hazard API's default port; override with HAZARD_API_URL when it runs elsewhere.
      '/api': { target: process.env.HAZARD_API_URL || 'http://127.0.0.1:3100', changeOrigin: true },
    },
  },
  preview: { port: 3000, host: '0.0.0.0' }
});
