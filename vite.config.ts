import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode single` inlines everything into one HTML file (portable / hostable anywhere).
export default defineConfig(({ mode }) => ({
  base: './', // relative asset paths so the build works under a GitHub Pages subpath
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  test: { globals: true, environment: 'node', include: ['src/**/*.test.ts'] },
}));
