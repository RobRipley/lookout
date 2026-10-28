import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
export default defineConfig(({ command }) => {
  const visualTest = process.env.LOOKOUT_VISUAL_TEST === '1';
  if (visualTest && command !== 'serve') throw new Error('Visual test identity cannot be included in production builds');
  const testConfig = visualTest ? JSON.parse(readFileSync('work/visual-env.json', 'utf8')) : null;
  return {
    resolve: visualTest ? { alias: { '@icp-sdk/auth/client': resolve('work/visual-auth.js') } } : {},
    plugins: visualTest ? [{ name: 'local-visual-test', configureServer(server) {
      server.middlewares.use((_request, response, next) => {
        response.setHeader('Set-Cookie', `ic_env=${encodeURIComponent(`ic_root_key=${testConfig.rootKey}&PUBLIC_CANISTER_ID:backend=${testConfig.backend}`)}; Path=/; SameSite=Lax`);
        next();
      });
    } }] : [],
    server: { host: '127.0.0.1', port: 5197, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8197' } },
  };
});
