import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';
/// <reference types="vitest" />

function spaBuildManifestPlugin(buildId: string): Plugin {
  return {
    name: 'spa-build-manifest',
    apply: 'build',
    writeBundle() {
      const id =
        buildId
        || process.env.VITE_SPA_BUILD_ID
        || process.env.RAILWAY_GIT_COMMIT_SHA
        || `build-${Date.now()}`;
      const dest = path.resolve(__dirname, 'dist', 'spa-build.json');
      fs.mkdirSync(path.dirname(dest), {recursive: true});
      fs.writeFileSync(
        dest,
        `${JSON.stringify({id, builtAt: new Date().toISOString()})}\n`,
        'utf8',
      );
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const localApiPort = env.LOCAL_API_PORT || env.VITE_LOCAL_API_PORT || '3001';
  const spaBuildId = (env.VITE_SPA_BUILD_ID || process.env.RAILWAY_GIT_COMMIT_SHA || '').trim();
  return {
    plugins: [react(), tailwindcss(), spaBuildManifestPlugin(spaBuildId)],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    test: {
      environment: 'node',
      globals: true,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
      // Allow the Google sign-in (signInWithPopup) window to close itself in dev.
      headers: { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' },
      // Dev: forward /api → Express (same origin as Vite so session cookies work with credentials: include)
      proxy:
        env.VITE_API_BASE_URL === '/api' || !env.VITE_API_BASE_URL
          ? { '/api': { target: `http://127.0.0.1:${localApiPort}`, changeOrigin: true } }
          : {},
    },
  };
});
