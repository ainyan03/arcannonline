import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  base: './', // GitHub Pages のサブパス配下でも動くよう相対パスにする
  server: {
    host: true,
    port: 5173,
  },
});
