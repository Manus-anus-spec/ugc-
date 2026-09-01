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
    build: {
      rollupOptions: {
        output: {
          // §P2: the bundle was one 513KB chunk, over Rollup's 500KB warning. Split the
          // libraries that never change out of the app code that changes on every deploy —
          // so a normal deploy invalidates ~100KB of app JS instead of the whole bundle, and
          // returning users re-download only what actually moved.
          //
          // Deliberately coarse. Fine-grained per-route splitting would need real lazy
          // boundaries (React.lazy + Suspense) and this app is a single tabbed surface where
          // every view is reachable immediately — route-splitting it would trade a smaller
          // first load for a spinner on every tab, which is worse here.
          // Split by module PATH, not by bare package name. Naming ids as
          // `{ react: ['react', 'react-dom'] }` looks right and silently under-splits:
          // the app imports `react-dom/client`, which does not match the bare id, so
          // react-dom stayed in the app chunk and the "react" chunk came out at 3.9KB.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'icons';
            return 'vendor';
          },
        },
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
