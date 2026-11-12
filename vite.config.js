import { defineConfig } from 'vite';

export default defineConfig({
  // base './' 保证打包后可被 Capacitor 以 file:// 方式加载（自包含 APK）
  base: './',
  server: {
    port: 5173,
    host: true,
    watch: {
      // 安卓打包产物不进模块图：cap sync 会往 android/ 里灌几千个文件，
      // 触发 dev server 反复重启 + 依赖重优化，表现就是动态 import（日记/文本账单）失败
      ignored: ['**/android/**', '**/dist/**', '**/.git/**'],
    },
  },
  optimizeDeps: {
    // vditor 只在日记页/文本账单里用到，且这两处都是动态 import。
    // 不预打包的话，首次进入时 Vite 才发现新依赖 → 当场重优化 → 这一次
    // dynamic import 拿到 504，浏览器报 "Failed to fetch dynamically imported module"。
    include: ['vditor'],
  },
  build: { outDir: 'dist', target: 'es2020' }
});