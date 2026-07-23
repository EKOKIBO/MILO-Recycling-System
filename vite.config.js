import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

import { cloudflare } from "@cloudflare/vite-plugin";

// npm i -D vite-plugin-pwa
export default defineConfig({
  plugins: [react(), VitePWA({
    // injectManifest (not generateSW) because we ship a custom service worker
    // with Web Push handlers — the auto-generated one can't host them.
    strategies: 'injectManifest',
    srcDir: 'src',
    filename: 'sw.js',
    registerType: 'autoUpdate',
    injectRegister: 'auto',
    includeAssets: ['icons/*.png', 'milo_mascot.png', 'milo_logo_full.png'],
    manifest: {
      name: 'MILO Smart Recycling',
      short_name: 'MILO',
      description: 'Smart recycling rewards — recycle, earn points, climb the leaderboard.',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      theme_color: '#4f46e5',
      background_color: '#f1f5f9',
      lang: 'en',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2}'],
    },
    devOptions: { enabled: false },
  }), cloudflare()],
});