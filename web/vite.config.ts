import { defineConfig } from 'vite';

export default defineConfig({
  // relative base so the same build works on a custom domain and on
  // <user>.github.io/<repo>/ project pages
  base: './',
  server: { host: '127.0.0.1', port: 5173 },
  build: { target: 'es2022', outDir: 'dist' },
});
