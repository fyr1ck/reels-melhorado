import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    // O front fala com /api e o proxy resolve — assim o mesmo código serve
    // em produção, onde o Express serve o build e /api é do mesmo host.
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } },
  },
});
