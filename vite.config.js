import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Principal } from '@icp-sdk/core/principal';
export default defineConfig(({ command }) => {
  const visualTest = process.env.LOOKOUT_VISUAL_TEST === '1';
  if (visualTest && command !== 'serve') throw new Error('Visual test identity cannot be included in production builds');
  const testConfig = visualTest ? JSON.parse(readFileSync('work/visual-env.json', 'utf8')) : null;
  return {
    resolve: visualTest ? { alias: { '@icp-sdk/auth/client': resolve('work/visual-auth.js') } } : {},
    plugins: [...(process.env.LOOKOUT_DISCOVERY_OPT_IN === '1' && command === 'build' ? [{ name: 'lookout-discovery', generateBundle() {
      const frontend = Principal.fromText(process.env.LOOKOUT_DISCOVERY_FRONTEND_ID || '').toText();
      const backend = Principal.fromText(process.env.LOOKOUT_DISCOVERY_BACKEND_ID || '').toText();
      if (frontend === '2vxsx-fae' || backend === '2vxsx-fae' || frontend === backend) throw new Error('Two distinct canister principals required');
      this.emitFile({type:'asset', fileName:'.well-known/ic-architecture', source:JSON.stringify({version:'1.0.0',canisters:[{id:frontend,name:'frontend',role:'the frontend'},{id:backend,name:'backend',role:'the backend'}]},null,2)+'\n'});
      this.emitFile({type:'asset', fileName:'.well-known/ii-derivation-origin', source:`https://${frontend}.icp0.io\n`});
    }}] : []), ...(visualTest ? [{ name: 'local-visual-test', configureServer(server) {
      server.middlewares.use((_request, response, next) => {
        response.setHeader('Set-Cookie', `ic_env=${encodeURIComponent(`ic_root_key=${testConfig.rootKey}&PUBLIC_CANISTER_ID:backend=${testConfig.backend}`)}; Path=/; SameSite=Lax`);
        next();
      });
    } }] : [])],
    server: { host: '127.0.0.1', port: 5197, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8197' } },
  };
});
