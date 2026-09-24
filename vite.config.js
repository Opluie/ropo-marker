import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base './' : GitHub Pages（/ropo-marker/）でもローカルでも同じビルドで動くよう相対パスにする
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: '六法マーカー',
        short_name: '六法',
        description: '条文を読んで3色マーカーを引く六法',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#faf8f0',
        theme_color: '#1f3a34',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 段階2は全法令を端末に保存する（3法令で約2.5MB）。法令が増える段階5で科目ごとの保存に切り替える
        globPatterns: ['**/*.{js,css,html,png,json}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
});
