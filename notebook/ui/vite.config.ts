import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({ resolve: { alias: {
  '@': path.resolve(import.meta.dirname, 'src'),
  '@powersync/tanstack-react-query': path.resolve(import.meta.dirname, 'src/local/disabled-row-sync.ts'),
  '@powersync/react': path.resolve(import.meta.dirname, 'src/local/disabled-row-sync.ts'),
  '@powersync/web': path.resolve(import.meta.dirname, 'src/local/disabled-row-sync.ts'),
}}, build: { assetsInlineLimit: 0 }, define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) }, server: { host:'127.0.0.1', port:4177, proxy:{'/api':'http://127.0.0.1:47831'} } });
