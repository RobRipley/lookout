import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { Principal } from '@icp-sdk/core/principal';

const identity = process.argv[2];
if (!identity) throw new Error('Usage: node scripts/init-local.mjs <icp-identity>');
const result = spawnSync('icp', ['identity', 'principal', '--identity', identity], { encoding: 'utf8' });
if (result.error || result.status !== 0) throw new Error('Could not read that identity. Create it with icp identity new first.');
const principal = Principal.fromText(result.stdout.trim());
if (principal.isAnonymous() || principal.toText() === 'aaaaa-aa') throw new Error('Choose a non-anonymous signing identity.');

await mkdir('work', { recursive: true, mode: 0o700 });
for (const path of ['work/install-args.did', 'work/owner-invite.txt']) {
  let exists = true;
  try { await access(path); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
  if (exists) throw new Error(`${path} already exists. Refusing to replace installation secrets.`);
}
const invitation = randomBytes(32).toString('hex');
await writeFile('work/install-args.did', `(principal "${principal.toText()}", "${invitation}")\n`, { mode: 0o600, flag: 'wx' });
await writeFile('work/owner-invite.txt', `${invitation}\n`, { mode: 0o600, flag: 'wx' });
console.log('Created private installation arguments and owner invitation under work/. Keep them out of Git.');
