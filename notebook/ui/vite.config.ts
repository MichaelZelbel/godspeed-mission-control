/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import path from 'node:path';
import { TEST_MS } from './src/test/wait-limits';
export default defineConfig({ build: { assetsInlineLimit: 0 }, esbuild:{jsx:'automatic'}, resolve: { alias: {
  '@': path.resolve(__dirname, 'src'),
  '@powersync/tanstack-react-query': path.resolve(__dirname, 'src/local/disabled-row-sync.ts'),
  '@powersync/react': path.resolve(__dirname, 'src/local/disabled-row-sync.ts'),
  '@powersync/web': path.resolve(__dirname, 'src/local/disabled-row-sync.ts'),
}}, define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) }, server: { host:'127.0.0.1', port:4177, proxy:{'/api':'http://127.0.0.1:47831'} }, test: { testTimeout: TEST_MS, projects: [
  { extends: true, test: { name: 'local' } },
  { extends: true, test: { name: 'los-angeles', env: { TZ: 'America/Los_Angeles' } } },
] } });
