import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  cacheDir: path.join(process.cwd(), '.vite-cache'),
  server: {
    port: 5173,
    host: '0.0.0.0'
  }
});

