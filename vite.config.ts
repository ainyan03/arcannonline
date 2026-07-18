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
});
