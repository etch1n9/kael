import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'KAEL_');
  const proxy = {
    '/api': {
      target: env.KAEL_API_PROXY_TARGET || 'http://127.0.0.1:1507',
      changeOrigin: true,
    },
  };

  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5173, strictPort: true, proxy },
    preview: { port: 4173, strictPort: true, proxy },
  };
});
