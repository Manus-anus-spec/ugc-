import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: '/ugc-/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@shared': path.resolve(__dirname, 'shared'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      hmr: process.env.DISABLE_HMR !== 'true',
      allowedHosts: true,
    },
  };
});
