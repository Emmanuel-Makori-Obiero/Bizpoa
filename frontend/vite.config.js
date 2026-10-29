import { defineConfig } from 'vite';

const backend = process.env.BIZPOA_BACKEND_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  envDir: '..',
  server: {
    proxy: {
      '/api': backend,
      '/health': backend,
    },
  },
});
