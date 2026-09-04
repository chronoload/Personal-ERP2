import { defineConfig } from 'vite';

export default defineConfig({
  // base './' 保证打包后可被 Capacitor 以 file:// 方式加载（自包含 APK）
  base: './',
  server: { port: 5173, host: true },
  build: { outDir: 'dist', target: 'es2020' }
});