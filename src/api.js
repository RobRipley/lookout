import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { idlFactory } from './idl';
import { safeGetCanisterEnv } from '@icp-sdk/core/agent/canister-env';
import { AuthClient } from '@icp-sdk/auth/client';

export const auth = new AuthClient();

export async function connect() {
  const env = safeGetCanisterEnv();
  const canisterId = env?.['PUBLIC_CANISTER_ID:backend'] || import.meta.env.VITE_BACKEND_ID;
  if (!canisterId) throw new Error('The board service is not configured. Please try again after deployment.');
  const agent = await HttpAgent.create({ identity: await auth.getIdentity(), host: window.location.origin, rootKey: env?.IC_ROOT_KEY });
  return Actor.createActor(idlFactory, { agent, canisterId });
}

export function captureInvitation() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const invite = fragment.get('invite');
  if (invite) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (/^[a-f0-9]{64}$/.test(invite)) sessionStorage.setItem('lookout-invite', invite);
  }
}
