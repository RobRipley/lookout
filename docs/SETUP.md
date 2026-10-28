# Setup and operation

## Installation and ownership

The backend constructor accepts a recovery administrator principal and a one-time invitation secret. `scripts/init-local.mjs IDENTITY` obtains that identity's principal from `icp` and creates a cryptographically random invitation in ignored, owner-readable files. The recovery administrator is fixed at installation; browser administrators are separate grants.

For a new workspace, use a dedicated deployment identity. Keep identity recovery material and installation arguments backed up privately. Do not commit them. Never reuse an invitation between test and production environments.

After deploying, open the frontend URL reported by `icp`. For the first browser owner, append `#invite=YOUR_INVITATION` and sign in with Internet Identity. Read the invitation from `work/owner-invite.txt` locally. Treat the full invitation URL as a secret. The app removes its fragment from the address bar and redeems it once; the canister stores a digest rather than the plaintext secret. A normal visitor cannot claim ownership just by signing in.

For local browser authentication, use an Internet Identity development setup appropriate to your local canister origin. The backend integration suite uses generated identities and does not depend on browser Internet Identity. Its `LOOKOUT_TEST_NETWORK=local` and `LOOKOUT_TEST_IDENTITY` settings are mandatory.

## Deploy to ICP

Use a separate checkout and fresh installation arguments for production. Fund the deployment identity's cycles account, check its balance, then deploy:

```sh
icp cycles balance -n ic --identity YOUR_DEPLOYMENT_IDENTITY
icp deploy -e ic --identity YOUR_DEPLOYMENT_IDENTITY
```

This creates an asset canister and a backend canister and consumes cycles. The generated mapping under `.icp/` belongs to your installation and is excluded from Git. The frontend reads the backend ID and root-key configuration from the asset canister's `ic_env` cookie; production code does not fetch a replacement root key.

For a later upgrade:

```sh
npm ci
npm test
icp deploy -e ic --no-create --identity YOUR_DEPLOYMENT_IDENTITY
```

The frontend recipe builds assets during deployment. Preserve the private installation-argument file because the CLI configuration references it for upgrades too. Constructor arguments do not replace existing persistent state on upgrade. **Do not reinstall a production backend**: that destroys its stored state. Check stable-state and Candid compatibility when changing the backend.

## Access and recovery

Administrators can call `setViewer`, `setPublisher`, and `setAdmin` to manage access. A publisher can read and update only its granted project; a viewer can read the workspace. The recovery principal can rotate the owner invitation with `setInvite` and revoke browser-admin access with `setAdmin`. Revoking a browser admin also removes that principal's viewer and publisher grants. Canister controllers have separate upgrade authority.

Use private argument files for calls containing invitations. Do not put secret values in command history or public issues. See `backend/backend.did` for the method signatures.

## Column aliases

Source columns are preserved by default. If a particular source uses both `Done`/`done` or `Blocked`/`blocked`, set `VITE_STANDARD_COLUMN_ALIASES` to a comma-separated list of project IDs in a private `.env.production.local` before building. Only those projects merge case variants of those two standard states. `.env.example` documents this optional build setting.

## Checks and backups

`npm test` covers publishing, metadata validation, priority mapping, column aliases, and explanations. `npm run build` produces the frontend. The local integration suite exercises authentication, scoped grants, concurrency, metadata, and archiving. GitHub CI runs the JavaScript tests and frontend build; it does not deploy anything or claim backend runtime coverage.

Use the signed-in app's Export action for board snapshots. Keep canonical source boards, private manifests, identity recovery material, and any operational records backed up separately. A public source repository is not a backup of your workspace data or keys.
