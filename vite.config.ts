import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// trystero が crypto.subtle を要求するため、セキュアコンテキストが必須。
// localhost は http でもセキュアコンテキストになるが、LAN 内の他端末から
// IP アドレスでアクセスする場合は HTTPS が必要 (`npm run dev:https`)。
const useHttps = process.env.HTTPS === '1';

export default defineConfig({
  root: 'client',
  base: './', // GitHub Pages のサブパス配下でも動くよう相対パスにする
  plugins: useHttps ? [basicSsl()] : [],
  server: {
    host: true,
    port: useHttps ? 5174 : 5173,
  },
  build: {
    // Three.js単体の実測は約507KB（gzip約127KB）。依存ライブラリを無理に
    // 細分化せず、ゲーム本体の肥大化は引き続き検知できる範囲にする。
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        // 描画ライブラリは更新頻度の高いゲーム本体から分離する。
        // 単一チャンクの肥大化を防ぎ、再デプロイ時のブラウザキャッシュも活かす。
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
